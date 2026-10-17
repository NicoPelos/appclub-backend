import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { anularPagoEventoParticipante } from '../../services/anularPagoEventoParticipante.service.js';
import EventoParticipante from '../../models/EventoParticipante.js';

const CLUB_ID = 'club1';
const MOVIMIENTO_ID = 'mov1';
const session = {};

const buildParticipante = (pagos) => ({
  _id: 'participante1',
  montoEsperadoSnapshot: 20000,
  montoPagadoSnapshot: pagos.reduce((s, p) => s + p.monto, 0),
  pagos: [...pagos],
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
});

beforeEach(() => {
  EventoParticipante.findOne = vi.fn();
});

afterEach(() => vi.restoreAllMocks());

describe('anularPagoEventoParticipante service (unit)', () => {
  it('vuelve a pendiente si el pago revertido era el único', async () => {
    const participante = buildParticipante([{ monto: 20000, movimientoId: MOVIMIENTO_ID }]);
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    const result = await anularPagoEventoParticipante({ clubId: CLUB_ID, movimientoId: MOVIMIENTO_ID, actor: 'admin@test.com', session });

    expect(participante.estado).toBe('pendiente');
    expect(participante.montoPagadoSnapshot).toBe(0);
    expect(participante.pagos).toHaveLength(0);
    expect(participante.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(participante);
  });

  it('queda parcial si revertir un pago deja otro pago vigente sin cubrir el total', async () => {
    const participante = buildParticipante([
      { monto: 8000, movimientoId: 'mov-sena' },
      { monto: 12000, movimientoId: MOVIMIENTO_ID },
    ]);
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await anularPagoEventoParticipante({ clubId: CLUB_ID, movimientoId: MOVIMIENTO_ID, actor: 'admin@test.com', session });

    expect(participante.estado).toBe('parcial');
    expect(participante.montoPagadoSnapshot).toBe(8000);
    expect(participante.pagos).toHaveLength(1);
    expect(participante.pagos[0].movimientoId).toBe('mov-sena');
  });

  it('queda pagada si el pago que queda ya cubre el total esperado', async () => {
    const participante = buildParticipante([
      { monto: 20000, movimientoId: 'mov-completo' },
      { monto: 5000, movimientoId: MOVIMIENTO_ID },
    ]);
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await anularPagoEventoParticipante({ clubId: CLUB_ID, movimientoId: MOVIMIENTO_ID, actor: 'admin@test.com', session });

    expect(participante.estado).toBe('pagada');
  });

  it('devuelve null si ningún participante tiene ese movimientoId (no hace nada)', async () => {
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    const result = await anularPagoEventoParticipante({ clubId: CLUB_ID, movimientoId: 'no-existe', actor: 'admin@test.com', session });

    expect(result).toBeNull();
  });

  it('busca por clubId + pagos.movimientoId + active:true', async () => {
    const participante = buildParticipante([{ monto: 20000, movimientoId: MOVIMIENTO_ID }]);
    EventoParticipante.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(participante) });

    await anularPagoEventoParticipante({ clubId: CLUB_ID, movimientoId: MOVIMIENTO_ID, actor: 'admin@test.com', session });

    expect(EventoParticipante.findOne).toHaveBeenCalledWith({ clubId: CLUB_ID, 'pagos.movimientoId': MOVIMIENTO_ID, active: true });
  });
});
