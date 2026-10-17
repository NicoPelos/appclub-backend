import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import {
  createAdminUser, createSocio, createEtiqueta, createPrecio, createSuscripcion,
} from '../../../../testUtils/integrationHelpers.js';

describe('POST /api/precios (integración)', () => {
  it('crea un precio para una etiqueta existente', async () => {
    const { token } = await createAdminUser();
    const etiqueta = await createEtiqueta();

    const res = await request(app)
      .post('/api/precios')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiquetaId: String(etiqueta._id), nombre: 'Cuota Social', unidad: 'mes', monto: 6000 });

    expect(res.status).toBe(201);
    expect(res.body.monto).toBe(6000);
  });

  it('rechaza una unidad inválida (400)', async () => {
    const { token } = await createAdminUser();
    const etiqueta = await createEtiqueta();

    const res = await request(app)
      .post('/api/precios')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiquetaId: String(etiqueta._id), nombre: 'X', unidad: 'año', monto: 100 });

    expect(res.status).toBe(400);
  });

  it('devuelve 404 si la etiqueta no existe', async () => {
    const { token } = await createAdminUser();
    const res = await request(app)
      .post('/api/precios')
      .set('Authorization', `Bearer ${token}`)
      .send({ etiquetaId: '000000000000000000000000', nombre: 'X', unidad: 'mes', monto: 100 });

    expect(res.status).toBe(404);
  });
});

describe('Vigencia de precios por fecha (integración vía cobro)', () => {
  it('usa el precio vigente correspondiente a la fecha del cobro, no siempre el más nuevo', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-01' });

    // Precio histórico, vigente hasta el 31/5
    await createPrecio({
      etiquetaId: etiqueta._id, monto: 4000, vigenteDesde: new Date('2020-01-01'), vigenteHasta: new Date('2026-05-31'),
    });
    // Precio nuevo, vigente desde el 1/6 en adelante
    await createPrecio({
      etiquetaId: etiqueta._id, monto: 5500, vigenteDesde: new Date('2026-06-01'), vigenteHasta: null,
    });

    const cobroViejo = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        date: '2026-04-15',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-04' }],
      });
    expect(cobroViejo.status).toBe(201);
    expect(cobroViejo.body.cobro.totalAmount).toBe(4000);

    const cobroNuevo = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        date: '2026-06-10',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-06' }],
      });
    expect(cobroNuevo.status).toBe(201);
    expect(cobroNuevo.body.cobro.totalAmount).toBe(5500);
  });

  it('sin un precio vigente configurado para la fecha, el cobro falla si no se manda amount', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2020-01' });

    await createPrecio({
      etiquetaId: etiqueta._id, monto: 4000, vigenteDesde: new Date('2020-01-01'), vigenteHasta: new Date('2020-12-31'),
    });

    const res = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${token}`)
      .send({
        paymentMethod: 'Efectivo',
        date: '2026-01-15',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-01' }],
      });

    expect(res.status).toBe(400);
  });
});
