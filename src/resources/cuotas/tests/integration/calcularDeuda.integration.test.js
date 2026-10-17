import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Cuota from '../../models/Cuota.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import { periodoDeFecha } from '../../../../services/fechaArgentina.js';
import {
  createAdminUser, createSocio, createEtiqueta, createPrecio, createSuscripcion,
} from '../../../../testUtils/integrationHelpers.js';

// Relativo al mes argentino, igual que el servidor (#283): con el mes UTC
// estos helpers se desfasaban las últimas 3 horas de cada mes.
const periodoDesplazado = (meses) => {
  const [year, month] = periodoDeFecha(new Date()).split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1 + meses, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const periodoHace = (mesesAtras) => periodoDesplazado(-mesesAtras);
const periodoEnMeses = (mesesAdelante) => periodoDesplazado(mesesAdelante);

describe('GET /api/socios/:id/deuda (integración)', () => {
  it('calcula meses de deuda desde fechaDesde cuando no hay cuotas pagadas', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 5000, vigenteDesde: new Date('2020-01-01') });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: periodoHace(3) });

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suscripciones).toHaveLength(1);
    expect(res.body.suscripciones[0].mesesDeuda).toBe(4); // hace 3 meses + el mes actual, inclusive
    expect(res.body.suscripciones[0].totalDeuda).toBe(4 * 5000);
    expect(res.body.suscripciones[0].ultimoPeriodoPagado).toBeNull();
    expect(res.body.otrosCargos).toEqual([]);
  });

  it('descuenta los períodos ya pagados de la deuda', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 5000, vigenteDesde: new Date('2020-01-01') });
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: periodoHace(3) });

    await Cuota.create({
      clubId: 'CARC',
      socioId: socio._id,
      suscripcionId: suscripcion._id,
      etiquetaId: etiqueta._id,
      periodo: periodoHace(3),
      estado: 'pagada',
      montoEsperadoSnapshot: 5000,
      montoPagadoSnapshot: 5000,
      paymentMethod: 'Efectivo',
      createdBy: 'test',
      updatedBy: 'test',
    });

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suscripciones[0].mesesDeuda).toBe(3);
    expect(res.body.suscripciones[0].ultimoPeriodoPagado).toBe(periodoHace(3));
  });

  it('devuelve 0 meses de deuda si la suscripción todavía no empezó', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 5000, vigenteDesde: new Date('2020-01-01') });
    await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: periodoEnMeses(2) });

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suscripciones[0].mesesDeuda).toBe(0);
    expect(res.body.suscripciones[0].totalDeuda).toBe(0);
  });

  // D3 (#263): se pueden adelantar cuotas, pero los meses que todavía no
  // llegaron no son deuda aunque la suscripción tenga fechaHasta futura.
  it('D3: con fechaHasta futura no cobra meses futuros, y un adelanto se puede registrar igual', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 5000, vigenteDesde: new Date('2020-01-01') });
    const suscripcion = await createSuscripcion({
      socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: periodoHace(1), fechaHasta: periodoEnMeses(3),
    });

    const adelanto = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: periodoEnMeses(2) }],
      });
    expect(adelanto.status).toBe(201);

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [deuda] = res.body.suscripciones;
    expect(deuda.periodos).toEqual([periodoHace(1), periodoHace(0)]);
    expect(deuda.mesesDeuda).toBe(2);
    expect(deuda.totalDeuda).toBe(2 * 5000);
    expect(deuda.ultimoPeriodoPagado).toBeNull();
    expect(deuda.periodosPagados).toEqual([periodoEnMeses(2)]);
    expect(deuda.vigente).toBe(true);
  });

  it('D3: en una suscripción abierta, un adelanto no descuenta la deuda del mes en curso ni cierra la suscripción', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta({ nombre: 'Escuelita', uso_sistema: 'cuota_escuelita' });
    await createPrecio({ etiquetaId: etiqueta._id, monto: 5000, vigenteDesde: new Date('2020-01-01') });
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: periodoHace(1) });

    const adelanto = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [1, 2].map((m) => ({ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: periodoEnMeses(m) })),
      });
    expect(adelanto.status).toBe(201);

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suscripciones).toHaveLength(1);
    expect(res.body.suscripciones[0]).toMatchObject({
      periodos: [periodoHace(1), periodoHace(0)],
      mesesDeuda: 2,
      totalDeuda: 2 * 5000,
      fechaHasta: null,
      vigente: true,
    });
    const enBase = await Suscripcion.findOne({ _id: suscripcion._id, clubId: 'CARC' }).lean();
    expect(enBase).toMatchObject({ fechaHasta: null, active: true });
  });

  it('devuelve suscripciones vacías si el socio no tiene suscripciones activas', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.suscripciones).toEqual([]);
    expect(res.body.otrosCargos).toEqual([]);
  });

  it('incluye deuda de muro libre cuando hay check-ins pendientes de pago', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiquetaMuroLibre = await createEtiqueta({ nombre: 'Muro Libre Diario Socio', uso_sistema: 'muro_libre_diario_socio', unidad: 'dia' });
    await createPrecio({ etiquetaId: etiquetaMuroLibre._id, monto: 2000, vigenteDesde: new Date('2020-01-01') });

    await request(app)
      .post('/api/muro-libre')
      .set('Authorization', `Bearer ${token}`)
      .send({ socioId: socio._id, tipoPase: 'diario', estadoPago: 'pendiente' });

    const res = await request(app)
      .get(`/api/socios/${socio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.otrosCargos).toEqual([expect.objectContaining({ tipo: 'muro_libre', cantidadPendiente: 1, totalDeuda: 2000 })]);
  });

  it('rechaza (403) si un socio intenta ver la deuda de otro socio', async () => {
    const socio = await createSocio();
    const otroSocio = await createSocio();
    const { token } = await createAdminUser({ roles: ['socio'], socioId: String(socio._id) });

    const res = await request(app)
      .get(`/api/socios/${otroSocio._id}/deuda`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});
