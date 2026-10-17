import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import {
  createAdminUser, createSocio, createEtiqueta, createSuscripcion,
} from '../../../../testUtils/integrationHelpers.js';

describe('POST /api/muro-libre (integración)', () => {
  it('registra un no-socio con monto manual y crea el movimiento de ingreso', async () => {
    const { user, token } = await createAdminUser();

    const res = await request(app)
      .post('/api/muro-libre')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Visitante', apellido: 'Ocasional', dni: '99999999', tipoPase: 'diario', estadoPago: 'pagado', paymentMethod: 'Efectivo', amount: 2000,
      });

    expect(res.status).toBe(201);
    expect(res.body.registro.monto).toBe(2000);
    expect(res.body.registro.esSocio).toBe(false);

    const movimiento = await Movimiento.findOne({ sourceId: res.body.registro._id });
    expect(movimiento.amount).toBe(2000);
    expect(movimiento.responsable).toBe(user.email);
    expect(movimiento.socioNombre).toBe('Visitante Ocasional');
  });

  it('rechaza un no-socio sin nombre (400)', async () => {
    const { token } = await createAdminUser();

    const res = await request(app)
      .post('/api/muro-libre')
      .set('Authorization', `Bearer ${token}`)
      .send({ tipoPase: 'diario', estadoPago: 'exento' });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/muro-libre — bloqueo diario por pase mensual activo (integración, appcarc-backend#277)', () => {
  const setupSocioConPase = async ({ fechaDesde, fechaHasta }) => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiquetaMensual = await createEtiqueta({ nombre: 'Muro Libre Mensual', uso_sistema: 'muro_libre_mensual_socio' });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiquetaMensual._id, fechaDesde, fechaHasta });
    return { token, socio };
  };

  const checkinDiario = (token, socio, fecha) => request(app)
    .post('/api/muro-libre')
    .set('Authorization', `Bearer ${token}`)
    .send({ socioId: String(socio._id), tipoPase: 'diario', estadoPago: 'exento', fecha });

  it('un pase mensual ya cerrado (fechaHasta pasada) no bloquea el check-in diario', async () => {
    const { token, socio } = await setupSocioConPase({ fechaDesde: '2026-03', fechaHasta: '2026-04' });

    const res = await checkinDiario(token, socio, '2026-08-15T15:00:00.000Z');

    expect(res.status).toBe(201);
    expect(res.body.registro.tipoPase).toBe('diario');
  });

  it('un pase mensual abierto sigue bloqueando el check-in diario', async () => {
    const { token, socio } = await setupSocioConPase({ fechaDesde: '2026-03', fechaHasta: null });

    const res = await checkinDiario(token, socio, '2026-08-15T15:00:00.000Z');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ya tiene un pase mensual activo');
  });

  it('un pase que cierra en el mismo mes del check-in todavía lo cubre (fechaHasta inclusiva)', async () => {
    const { token, socio } = await setupSocioConPase({ fechaDesde: '2026-03', fechaHasta: '2026-08' });

    const res = await checkinDiario(token, socio, '2026-08-15T15:00:00.000Z');

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ya tiene un pase mensual activo');
  });
});

describe('POST /api/muro-libre — pase mensual con una suscripción ya cerrada (integración, appcarc-backend#282)', () => {
  const setup = async (suscripciones) => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiquetaMensual = await createEtiqueta({ nombre: 'Muro Libre Mensual', uso_sistema: 'muro_libre_mensual_socio' });
    const creadas = [];
    for (const s of suscripciones) {
      creadas.push(await createSuscripcion({ socioId: socio._id, etiquetaId: etiquetaMensual._id, ...s }));
    }
    return { token, socio, etiquetaMensual, creadas };
  };

  const checkinMensual = (token, socio, body) => request(app)
    .post('/api/muro-libre')
    .set('Authorization', `Bearer ${token}`)
    .send({ socioId: String(socio._id), tipoPase: 'mensual', fecha: '2026-08-15T15:00:00.000Z', ...body });

  it('pagado: crea una suscripción nueva y cuelga la cuota de ella, sin tocar la cerrada', async () => {
    const { token, socio, etiquetaMensual, creadas: [cerrada] } = await setup([{ fechaDesde: '2026-03', fechaHasta: '2026-04' }]);

    const res = await checkinMensual(token, socio, { estadoPago: 'pagado', paymentMethod: 'Efectivo', monto: 8000 });

    expect(res.status).toBe(201);
    const suscripciones = await Suscripcion.find({ socioId: socio._id, etiquetaId: etiquetaMensual._id }).sort({ fechaDesde: 1 }).lean();
    expect(suscripciones).toHaveLength(2);
    expect(suscripciones[0]).toMatchObject({ fechaDesde: '2026-03', fechaHasta: '2026-04' });
    expect(suscripciones[1]).toMatchObject({ fechaDesde: '2026-08', fechaHasta: null });

    const cuota = await Cuota.findOne({ socioId: socio._id, etiquetaId: etiquetaMensual._id, periodo: '2026-08' }).lean();
    expect(String(cuota.suscripcionId)).toBe(String(suscripciones[1]._id));
    expect(String(cuota.suscripcionId)).not.toBe(String(cerrada._id));
  });

  it('impago: igual crea la suscripción vigente, así el pase queda como deuda', async () => {
    const { token, socio, etiquetaMensual } = await setup([{ fechaDesde: '2026-03', fechaHasta: '2026-04' }]);

    const res = await checkinMensual(token, socio, { estadoPago: 'pendiente' });

    expect(res.status).toBe(201);
    const vigente = await Suscripcion.findOne({ socioId: socio._id, etiquetaId: etiquetaMensual._id, fechaHasta: null }).lean();
    expect(vigente).toMatchObject({ fechaDesde: '2026-08' });
  });

  it('con una cerrada y otra vigente, usa la vigente y no crea otra', async () => {
    const { token, socio, etiquetaMensual, creadas: [, vigente] } = await setup([
      { fechaDesde: '2026-03', fechaHasta: '2026-04' },
      { fechaDesde: '2026-06', fechaHasta: null },
    ]);

    const res = await checkinMensual(token, socio, { estadoPago: 'pagado', paymentMethod: 'Efectivo', monto: 8000 });

    expect(res.status).toBe(201);
    expect(await Suscripcion.countDocuments({ socioId: socio._id, etiquetaId: etiquetaMensual._id })).toBe(2);
    const cuota = await Cuota.findOne({ socioId: socio._id, etiquetaId: etiquetaMensual._id, periodo: '2026-08' }).lean();
    expect(String(cuota.suscripcionId)).toBe(String(vigente._id));
  });
});

describe('PUT /api/muro-libre/:id (integración)', () => {
  it('actualiza el monto y propaga el cambio al movimiento asociado', async () => {
    const { token } = await createAdminUser();
    const createRes = await request(app)
      .post('/api/muro-libre')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Visitante', tipoPase: 'diario', estadoPago: 'pagado', paymentMethod: 'Efectivo', amount: 1000,
      });

    const res = await request(app)
      .put(`/api/muro-libre/${createRes.body.registro._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 1800 });

    expect(res.status).toBe(200);
    expect(res.body.monto).toBe(1800);

    const movimiento = await Movimiento.findOne({ sourceId: createRes.body.registro._id });
    expect(movimiento.amount).toBe(1800);
  });

  it('rechaza un monto negativo (400)', async () => {
    const { token } = await createAdminUser();
    const createRes = await request(app)
      .post('/api/muro-libre')
      .set('Authorization', `Bearer ${token}`)
      .send({ nombre: 'Visitante', tipoPase: 'diario', estadoPago: 'exento' });

    const res = await request(app)
      .put(`/api/muro-libre/${createRes.body.registro._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: -5 });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/muro-libre/:id (integración)', () => {
  it('anula el registro y desactiva el movimiento asociado', async () => {
    const { token } = await createAdminUser();
    const createRes = await request(app)
      .post('/api/muro-libre')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nombre: 'Visitante', tipoPase: 'diario', estadoPago: 'pagado', paymentMethod: 'Efectivo', amount: 1000,
      });

    const delRes = await request(app)
      .delete(`/api/muro-libre/${createRes.body.registro._id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    const movimiento = await Movimiento.findOne({ sourceId: createRes.body.registro._id });
    expect(movimiento.active).toBe(false);

    const updateRes = await request(app)
      .put(`/api/muro-libre/${createRes.body.registro._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ monto: 500 });
    expect(updateRes.status).toBe(404);
  });
});
