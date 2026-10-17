import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

import app from '../../../../index.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import User from '../../../usuarios/models/User.js';
import * as pushNotificationService from '../../../../services/pushNotification.service.js';
import {
  CLUB_ID, createAdminUser, createSocio, createEtiqueta, createPrecio, createSuscripcion, getOrCreateRol,
} from '../../../../testUtils/integrationHelpers.js';

// Bajo isolate:false (ver vitest.integration.config.js) todos los archivos
// de integración comparten un único module graph: si OTRO archivo ya
// importó app/createCobro.handler.js antes de que el vi.mock(...) de este
// archivo llegara a aplicarse, ese import queda atado para siempre a la
// implementación real de sendPushNotification (los bindings de ESM se
// resuelven una sola vez, al evaluar el módulo por primera vez) — el mock
// nunca se nota y el test queda flaky según el orden de ejecución de los
// demás archivos. vi.spyOn sobre el namespace ya importado no depende de
// quién lo importó primero: parchea la función en el mismo objeto que
// cualquier otro importador ya está usando.
let sendPushNotification;
beforeEach(() => {
  sendPushNotification = vi.spyOn(pushNotificationService, 'sendPushNotification').mockResolvedValue({ sent: 1 });
});
afterEach(() => {
  sendPushNotification.mockRestore();
});

const setupSocioConSuscripcion = async () => {
  const socio = await createSocio();
  const etiqueta = await createEtiqueta();
  await createPrecio({ etiquetaId: etiqueta._id, monto: 5000 });
  const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id });
  return { socio, etiqueta, suscripcion };
};

describe('POST /api/cobros (integración)', () => {
  it('registra un cobro, crea la cuota pagada y el movimiento de ingreso', async () => {
    const { token } = await createAdminUser();
    const { socio, suscripcion } = await setupSocioConSuscripcion();

    const res = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-01' }],
      });

    expect(res.status).toBe(201);
    expect(res.body.cobro.totalAmount).toBe(5000);

    const cuota = await Cuota.findOne({ socioId: socio._id, periodo: '2026-01' });
    expect(cuota.estado).toBe('pagada');
    expect(cuota.montoPagadoSnapshot).toBe(5000);
    expect(String(cuota.cobroId)).toBe(String(res.body.cobro._id));

    const movimiento = await Movimiento.findOne({ sourceId: res.body.cobro._id });
    expect(movimiento).toBeTruthy();
    expect(movimiento.type).toBe('Ingreso');
    expect(movimiento.amount).toBe(5000);
    expect(String(movimiento.socioId)).toBe(String(socio._id));
    expect(movimiento.socioNombre).toBe(`${socio.nombre} ${socio.apellido}`);
  });

  it('envía la notificación push con el nombre de la etiqueta, sin "null" (regresión)', async () => {
    const { token } = await createAdminUser();
    const { socio, suscripcion } = await setupSocioConSuscripcion();

    const rolSocio = await getOrCreateRol({ clubId: CLUB_ID, nombre: 'socio' });
    await User.create({
      email: `socio-${socio._id}@carc.local`,
      password: 'hashed-not-used',
      roles: [rolSocio._id],
      clubId: CLUB_ID,
      socioId: String(socio._id),
      expoPushToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]',
      active: true,
    });

    sendPushNotification.mockClear();

    const res = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{
          socioId: String(socio._id),
          suscripcionId: String(suscripcion._id),
          periodoDesde: '2026-01',
          cantidad: 5,
        }],
      });
    expect(res.status).toBe(201);

    await vi.waitFor(() => expect(sendPushNotification).toHaveBeenCalledTimes(1));

    const [, notification] = sendPushNotification.mock.calls[0];
    expect(notification.body).not.toContain('null');
    expect(notification.body).toBe(
      'Se registraron 5 pagos: cuota social enero 2026, cuota social febrero 2026, cuota social marzo 2026, cuota social abril 2026, cuota social mayo 2026',
    );
  });

  it('rechaza un cobro si la cuota del período ya está pagada (409)', async () => {
    const { token } = await createAdminUser();
    const { socio, suscripcion } = await setupSocioConSuscripcion();

    const payload = {
      paymentMethod: 'Efectivo',
      items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-03' }],
    };

    const first = await request(app).post('/api/cobros').set('Authorization', `Bearer ${token}`).send(payload);
    expect(first.status).toBe(201);

    const second = await request(app).post('/api/cobros').set('Authorization', `Bearer ${token}`).send(payload);
    expect(second.status).toBe(409);

    const cuotasPagadas = await Cuota.countDocuments({ socioId: socio._id, periodo: '2026-03', estado: 'pagada' });
    expect(cuotasPagadas).toBe(1);
  });

  it('rechaza un cobro para un socio de otro club (404)', async () => {
    const { token } = await createAdminUser({ clubId: CLUB_ID });
    const { suscripcion } = await setupSocioConSuscripcion();
    const socioOtroClub = await createSocio({ clubId: 'OTRO_CLUB' });

    const res = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socioOtroClub._id), suscripcionId: String(suscripcion._id), periodo: '2026-02' }],
      });

    expect(res.status).toBe(404);
  });
});

describe('POST /api/cobros/:id/anular (integración)', () => {
  it('anula un cobro y revierte la cuota y el movimiento asociados', async () => {
    const { token } = await createAdminUser();
    const { socio, suscripcion } = await setupSocioConSuscripcion();

    const cobroRes = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-04' }],
      });
    expect(cobroRes.status).toBe(201);
    const cobroId = cobroRes.body.cobro._id;

    const anularRes = await request(app)
      .post(`/api/cobros/${cobroId}/anular`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'Test de anulación' });

    expect(anularRes.status).toBe(200);

    const cuota = await Cuota.findOne({ socioId: socio._id, periodo: '2026-04' });
    expect(cuota.estado).toBe('anulada');

    const movimiento = await Movimiento.findOne({ sourceId: cobroId });
    expect(movimiento.active).toBe(false);
  });

  it('rechaza anular un cobro ya anulado (409)', async () => {
    const { token } = await createAdminUser();
    const { socio, suscripcion } = await setupSocioConSuscripcion();

    const cobroRes = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-05' }],
      });
    const cobroId = cobroRes.body.cobro._id;

    const first = await request(app).post(`/api/cobros/${cobroId}/anular`).set('Authorization', `Bearer ${token}`).send({});
    expect(first.status).toBe(200);

    const second = await request(app).post(`/api/cobros/${cobroId}/anular`).set('Authorization', `Bearer ${token}`).send({});
    expect(second.status).toBe(409);
  });
});
