import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../../movimientos/models/Movimiento.js', () => ({
  default: { findOne: vi.fn(), findByIdAndUpdate: vi.fn() },
}));
vi.mock('../../models/EventoParticipante.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../services/anularPagoEventoParticipante.service.js', () => ({
  anularPagoEventoParticipante: vi.fn(),
}));
vi.mock('../../services/registrarPagoEventoParticipante.service.js', async () => {
  const actual = await vi.importActual('../../services/registrarPagoEventoParticipante.service.js');
  return { ...actual, registrarPagoEventoParticipante: vi.fn() };
});

import Movimiento from '../../../movimientos/models/Movimiento.js';
import EventoParticipante from '../../models/EventoParticipante.js';
import { anularPagoEventoParticipante } from '../../services/anularPagoEventoParticipante.service.js';
import { registrarPagoEventoParticipante } from '../../services/registrarPagoEventoParticipante.service.js';
import { cambiarFormaPagoEventoParticipante } from '../../services/cambiarFormaPagoEventoParticipante.service.js';

const CLUB_ID = 'club1';
const EVENTO_ID = '507f1f77bcf86cd799439011';
const PARTICIPANTE_ID = '507f1f77bcf86cd799439012';
const MOVIMIENTO_ID = '507f1f77bcf86cd799439013';
const USER = { id: 'user1', email: 'secretaria@carc.test' };

const buildMovimiento = (overrides = {}) => ({
  _id: MOVIMIENTO_ID,
  clubId: CLUB_ID,
  sourceType: 'evento_participante',
  paymentMethod: 'Efectivo',
  date: new Date('2026-09-01T12:00:00Z'),
  mercadopagoVinculos: [],
  ...overrides,
});

const buildParticipante = (overrides = {}) => ({
  _id: PARTICIPANTE_ID,
  eventoId: EVENTO_ID,
  clubId: CLUB_ID,
  pagos: [{ monto: 15000, fecha: new Date(), paymentMethod: 'Efectivo', movimientoId: MOVIMIENTO_ID, esPagoParcial: true }],
  ...overrides,
});

describe('cambiarFormaPagoEventoParticipante (unit)', () => {
  let sessionMock;

  beforeEach(() => {
    vi.clearAllMocks();
    sessionMock = { withTransaction: vi.fn(async (cb) => cb()), endSession: vi.fn() };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);

    Movimiento.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(buildMovimiento()) });
    Movimiento.findByIdAndUpdate = vi.fn().mockResolvedValue(null);
    EventoParticipante.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(buildParticipante()) });
    anularPagoEventoParticipante.mockResolvedValue({});
    registrarPagoEventoParticipante.mockResolvedValue({ participante: { _id: PARTICIPANTE_ID }, movimiento: { _id: 'nuevoMov1' } });
  });

  afterEach(() => vi.restoreAllMocks());

  it('rechaza una forma de pago inválida', async () => {
    await expect(cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Bitcoin',
    })).rejects.toMatchObject({ status: 400 });
  });

  it('falla con 404 si el movimiento no existe', async () => {
    Movimiento.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    await expect(cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Transferencia',
    })).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza si el movimiento no es de un evento', async () => {
    Movimiento.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(buildMovimiento({ sourceType: 'cobro' })) });
    await expect(cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Transferencia',
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('no corresponde a un pago de evento') });
  });

  it('rechaza si ya está en esa forma de pago', async () => {
    await expect(cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Efectivo',
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('ya está registrado') });
  });

  it('rechaza si el movimiento tiene pagos de Mercado Pago vinculados', async () => {
    Movimiento.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(buildMovimiento({ mercadopagoVinculos: [{ paymentId: 'mp1' }] })) });
    await expect(cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Transferencia',
    })).rejects.toMatchObject({ status: 400, message: expect.stringContaining('Mercado Pago') });
  });

  it('falla con 404 si el pago no pertenece a ese participante', async () => {
    EventoParticipante.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(buildParticipante({ pagos: [] })) });
    await expect(cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Transferencia',
    })).rejects.toMatchObject({ status: 404, message: expect.stringContaining('no pertenece') });
  });

  it('anula el pago original, desactiva el movimiento viejo y registra uno nuevo con el mismo monto y esPagoParcial', async () => {
    const result = await cambiarFormaPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, movimientoId: MOVIMIENTO_ID, paymentMethod: 'Transferencia',
    });

    expect(Movimiento.findByIdAndUpdate).toHaveBeenCalledWith(
      MOVIMIENTO_ID,
      { active: false, updatedBy: USER.email },
      { session: sessionMock },
    );
    expect(anularPagoEventoParticipante).toHaveBeenCalledWith({
      clubId: CLUB_ID, movimientoId: MOVIMIENTO_ID, actor: USER.email, session: sessionMock,
    });
    expect(registrarPagoEventoParticipante).toHaveBeenCalledWith({
      clubId: CLUB_ID,
      user: USER,
      eventoId: EVENTO_ID,
      participanteId: PARTICIPANTE_ID,
      monto: 15000,
      paymentMethod: 'Transferencia',
      esPagoParcial: true,
      date: buildMovimiento().date,
    });
    expect(result).toEqual({ participante: { _id: PARTICIPANTE_ID }, movimiento: { _id: 'nuevoMov1' } });
  });
});
