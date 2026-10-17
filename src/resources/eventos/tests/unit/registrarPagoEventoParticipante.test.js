import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { BusinessError, registrarPagoEventoParticipante } from '../../services/registrarPagoEventoParticipante.service.js';
import Evento from '../../models/Evento.js';
import EventoParticipante from '../../models/EventoParticipante.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';

const CLUB_ID = 'club1';
const EVENTO_ID = '507f1f77bcf86cd799439011';
const PARTICIPANTE_ID = '507f1f77bcf86cd799439013';
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

const buildEvento = (overrides = {}) => ({
  _id: EVENTO_ID,
  nombre: 'Trekking a Cerro Negro',
  categoria: 'Viajes',
  estado: 'abierto',
  ...overrides,
});

const buildParticipante = (overrides = {}) => ({
  _id: PARTICIPANTE_ID,
  socioId: null,
  nombre: 'Juan',
  apellido: 'Pérez',
  montoEsperadoSnapshot: 20000,
  montoPagadoSnapshot: 0,
  estado: 'pendiente',
  pagos: [],
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  ...overrides,
});

const validBody = { monto: 20000, paymentMethod: 'Efectivo' };

describe('registrarPagoEventoParticipante service (unit)', () => {
  let sessionMock;
  let movimientoSaveSpy;
  let savedMovimientos;

  beforeEach(() => {
    savedMovimientos = [];
    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);

    Evento.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(buildEvento()) });
    EventoParticipante.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(buildParticipante()) });

    movimientoSaveSpy = vi.spyOn(Movimiento.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedMovimientos.push(this);
      return this;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('registra un pago completo y cierra el participante como pagada', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    const result = await registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    });

    expect(participante.estado).toBe('pagada');
    expect(participante.montoPagadoSnapshot).toBe(20000);
    expect(participante.pagos).toHaveLength(1);
    expect(savedMovimientos).toHaveLength(1);
    expect(savedMovimientos[0]).toMatchObject({
      type: 'Ingreso', amount: 20000, categoria: 'Viajes', sourceType: 'evento_participante', socioId: null,
    });
    // appcarc-backend#180: eventoId seteado directo en el Movimiento, no
    // solo derivable vía sourceId -> EventoParticipante -> eventoId.
    expect(String(savedMovimientos[0].eventoId)).toBe(EVENTO_ID);
    expect(result.participante).toBe(participante);
  });

  it('un ajuste de monto (sin esPagoParcial) cierra igual, aunque sea menos de lo esperado', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 15000, paymentMethod: 'Efectivo',
    });

    expect(participante.estado).toBe('pagada');
  });

  it('appcarc-backend#175: con esPagoParcial:true y monto insuficiente, queda parcial', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 8000, paymentMethod: 'Efectivo', esPagoParcial: true,
    });

    expect(participante.estado).toBe('parcial');
    expect(participante.montoPagadoSnapshot).toBe(8000);
  });

  it('pagar el saldo de un participante parcial lo cierra a pagada', async () => {
    const participante = buildParticipante({ estado: 'parcial', montoPagadoSnapshot: 8000, pagos: [{ monto: 8000, movimientoId: 'mov1' }] });
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 12000, paymentMethod: 'Efectivo', esPagoParcial: true,
    });

    expect(participante.estado).toBe('pagada');
    expect(participante.montoPagadoSnapshot).toBe(20000);
    expect(participante.pagos).toHaveLength(2);
  });

  it('rechaza un participante ya pagado', async () => {
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(buildParticipante({ estado: 'pagada' })) });

    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza un participante anulado', async () => {
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(buildParticipante({ estado: 'anulada' })) });

    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza si el evento está cerrado', async () => {
    Evento.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(buildEvento({ estado: 'cerrado' })) });

    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza si el evento no existe', async () => {
    Evento.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza si el participante no existe', async () => {
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('rechaza monto <= 0', async () => {
    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 0, paymentMethod: 'Efectivo',
    })).rejects.toBeInstanceOf(BusinessError);
  });

  it('rechaza paymentMethod inválido', async () => {
    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 1000, paymentMethod: 'Cheque',
    })).rejects.toBeInstanceOf(BusinessError);
  });

  // Habilitado para el autoservicio de pago de eventos por Mercado Pago
  // (self-service desde "Deudas y pagos" vía crearPreferenciaCobroPropioMercadoPago
  // + procesarPagoMercadoPago) — antes solo Efectivo/Transferencia eran válidos.
  it('acepta paymentMethod MercadoPago', async () => {
    const participante = buildParticipante();
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, monto: 20000, paymentMethod: 'MercadoPago',
    });

    expect(participante.estado).toBe('pagada');
    expect(participante.pagos[0]).toMatchObject({ paymentMethod: 'MercadoPago' });
  });

  it('rechaza fecha futura', async () => {
    const manana = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody, date: manana,
    })).rejects.toBeInstanceOf(BusinessError);
  });

  it('rechaza si falta clubId', async () => {
    await expect(registrarPagoEventoParticipante({
      clubId: undefined, user: USER, eventoId: EVENTO_ID, participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toMatchObject({ status: 401 });
    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('rechaza IDs inválidos', async () => {
    await expect(registrarPagoEventoParticipante({
      clubId: CLUB_ID, user: USER, eventoId: 'invalido', participanteId: PARTICIPANTE_ID, ...validBody,
    })).rejects.toBeInstanceOf(BusinessError);
  });
});
