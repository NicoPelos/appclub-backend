import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import {
  createAdminUser, createSocio, createEtiqueta, createPrecio,
} from '../../../../testUtils/integrationHelpers.js';

const periodoActual = () => {
  const OFFSET_MS = -3 * 60 * 60 * 1000;
  const local = new Date(Date.now() + OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
};

describe('POST /api/muro-libre/checkin (integración)', () => {
  it('registra check-in diario pagado y crea el movimiento de ingreso, usando el precio vigente configurado', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiquetaDiario = await createEtiqueta({ nombre: 'Muro Libre Diario Socio', uso_sistema: 'muro_libre_diario_socio' });
    await createPrecio({ etiquetaId: etiquetaDiario._id, monto: 1500, unidad: 'dia' });

    const res = await request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        dni: socio.dni, tipoPase: 'diario', estadoPago: 'pagado', paymentMethod: 'Efectivo',
      });

    expect(res.status).toBe(201);
    expect(res.body.asistencia.monto).toBe(1500);

    const movimiento = await Movimiento.findOne({ sourceId: res.body.asistencia._id });
    expect(movimiento).toBeTruthy();
    expect(movimiento.amount).toBe(1500);
  });

  it('marca advertencia CUOTA_SOCIAL_IMPAGA si el socio no pagó la cuota social (verifica el fix de etiquetaId)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    // Fecha fija de un mes ya vencido (no el mes real en curso) — evita
    // depender de la ventana de gracia del mes actual (días 1-10, ver
    // dentroDeVentanaDeGracia), que suprimiría esta advertencia si el test
    // corriera esos días.
    const res = await request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({
        dni: socio.dni, tipoPase: 'diario', estadoPago: 'exento', fecha: '2026-02-15T15:00:00.000Z',
      });

    expect(res.status).toBe(201);
    expect(res.body.advertencias.some((a) => a.codigo === 'CUOTA_SOCIAL_IMPAGA')).toBe(true);
  });

  it('no marca advertencia de cuota social si está pagada por etiquetaId', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();
    const etiquetaSocial = await createEtiqueta({ nombre: 'Cuota Social', uso_sistema: 'cuota_social' });
    await Cuota.create({
      clubId: 'CARC',
      socioId: socio._id,
      etiquetaId: etiquetaSocial._id,
      periodo: periodoActual(),
      estado: 'pagada',
      montoEsperadoSnapshot: 5000,
      montoPagadoSnapshot: 5000,
      paymentMethod: 'Efectivo',
      createdBy: 'test',
      updatedBy: 'test',
    });

    const res = await request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ dni: socio.dni, tipoPase: 'diario', estadoPago: 'exento' });

    expect(res.status).toBe(201);
    expect(res.body.advertencias.some((a) => a.codigo === 'CUOTA_SOCIAL_IMPAGA')).toBe(false);
  });

  it('rechaza un segundo check-in de muro libre el mismo día (409)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const first = await request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ dni: socio.dni, tipoPase: 'diario', estadoPago: 'exento' });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ dni: socio.dni, tipoPase: 'diario', estadoPago: 'exento' });
    expect(second.status).toBe(409);
  });

  it('rechaza check-ins concurrentes del mismo socio el mismo día (índice único, no solo el chequeo en memoria)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const send = () => request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ dni: socio.dni, tipoPase: 'diario', estadoPago: 'exento' });

    const [a, b] = await Promise.all([send(), send()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
  });

  it('rechaza un tipoPase inválido (400)', async () => {
    const { token } = await createAdminUser();
    const socio = await createSocio();

    const res = await request(app)
      .post('/api/muro-libre/checkin')
      .set('Authorization', `Bearer ${token}`)
      .send({ dni: socio.dni, tipoPase: 'anual', estadoPago: 'exento' });

    expect(res.status).toBe(400);
  });
});
