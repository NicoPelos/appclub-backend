import { describe, it, expect } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import app from '../../../../index.js';
import User from '../../../usuarios/models/User.js';
import Evento from '../../../eventos/models/Evento.js';
import EventoParticipante from '../../../eventos/models/EventoParticipante.js';
import {
  CLUB_ID, createAdminUser, createSocio, createEtiqueta, createPrecio, createSuscripcion, getOrCreateRol,
} from '../../../../testUtils/integrationHelpers.js';

// appcarc-backend#266: el pago de un evento nunca generaba un Cobro, así que
// GET /api/cobros ('Pagos realizados' en mobile) lo dejaba afuera del
// historial aunque el dinero se haya movido bien. Reproduce el caso real
// reportado: un socio paga la deuda de un evento y después mira su propio
// historial de pagos (autoservicio, vía authorizeSelfYVinculadosOr).
const createSocioUserToken = async (socio) => {
  const rolSocio = await getOrCreateRol({ clubId: CLUB_ID, nombre: 'socio' });
  const user = await User.create({
    email: `${socio._id}@carc.local`,
    password: 'hashed-not-used',
    roles: [rolSocio._id],
    clubId: CLUB_ID,
    socioId: socio._id,
    active: true,
  });
  return jwt.sign({ id: user._id, roles: [rolSocio.slug], clubId: CLUB_ID }, process.env.JWT_SECRET, { expiresIn: '1h' });
};

describe('GET /api/cobros (integración) — appcarc-backend#266', () => {
  it('el historial de pagos del propio socio (autoservicio) incluye un pago de evento ya registrado', async () => {
    const { token: adminToken } = await createAdminUser();
    const socio = await createSocio();
    const socioToken = await createSocioUserToken(socio);

    const evento = await Evento.create({
      clubId: CLUB_ID, nombre: 'Remeras CARC', categoria: 'Ventas / Reventa', fecha: new Date(),
    });
    const participante = await EventoParticipante.create({
      clubId: CLUB_ID, eventoId: evento._id, socioId: socio._id,
      nombre: socio.nombre, apellido: socio.apellido, montoEsperadoSnapshot: 15000,
    });

    // Registra el pago real por el endpoint real (staff cobrando, pero el
    // efecto es el mismo que el flujo de autoservicio: un Movimiento con
    // sourceType 'evento_participante', sin Cobro).
    const pagoRes = await request(app)
      .post(`/api/eventos/${evento._id}/participantes/${participante._id}/pagos`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ monto: 15000, paymentMethod: 'MercadoPago' });
    expect(pagoRes.status).toBe(201);

    const historialRes = await request(app)
      .get('/api/cobros')
      .set('Authorization', `Bearer ${socioToken}`);

    expect(historialRes.status).toBe(200);
    expect(historialRes.body.total).toBe(1);
    expect(historialRes.body.cobros).toHaveLength(1);
    expect(historialRes.body.cobros[0]).toMatchObject({
      tipo: 'evento',
      paymentMethod: 'MercadoPago',
      totalAmount: 15000,
      description: 'Evento: Remeras CARC',
    });
    expect(String(historialRes.body.cobros[0].items[0].socioId)).toBe(String(socio._id));
  });

  it('mezcla un cobro de cuota y un pago de evento del mismo socio, ordenados por fecha', async () => {
    const { token: adminToken } = await createAdminUser();
    const socio = await createSocio();
    const socioToken = await createSocioUserToken(socio);
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 5000 });
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id });

    const cobroRes = await request(app)
      .post('/api/cobros')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        paymentMethod: 'Efectivo',
        items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodo: '2026-01' }],
      });
    expect(cobroRes.status).toBe(201);

    const evento = await Evento.create({
      clubId: CLUB_ID, nombre: 'Asado', categoria: 'Viajes', fecha: new Date(),
    });
    const participante = await EventoParticipante.create({
      clubId: CLUB_ID, eventoId: evento._id, socioId: socio._id,
      nombre: socio.nombre, apellido: socio.apellido, montoEsperadoSnapshot: 3000,
    });
    const pagoRes = await request(app)
      .post(`/api/eventos/${evento._id}/participantes/${participante._id}/pagos`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ monto: 3000, paymentMethod: 'Transferencia' });
    expect(pagoRes.status).toBe(201);

    const historialRes = await request(app)
      .get('/api/cobros')
      .set('Authorization', `Bearer ${socioToken}`);

    expect(historialRes.status).toBe(200);
    expect(historialRes.body.total).toBe(2);
    const tipos = historialRes.body.cobros.map((c) => c.tipo).sort();
    expect(tipos).toEqual(['cobro', 'evento']);
  });
});
