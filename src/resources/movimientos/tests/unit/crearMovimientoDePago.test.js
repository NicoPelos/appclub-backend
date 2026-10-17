import { beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { crearMovimientoDePago } from '../../services/crearMovimientoDePago.service.js';
import Movimiento from '../../models/Movimiento.js';

describe('crearMovimientoDePago (unit)', () => {
  let saveSpy;
  let sessionMock;

  beforeEach(() => {
    sessionMock = { id: 'session1' };
    saveSpy = vi.spyOn(Movimiento.prototype, 'save').mockImplementation(async function (opts) {
      this._saveOpts = opts;
      return this;
    });
  });

  it('arma un Movimiento de Ingreso con los datos recibidos y lo guarda con la sesión', async () => {
    const date = new Date('2026-09-14T15:00:00Z');
    const movimiento = await crearMovimientoDePago({
      clubId: 'club1',
      userId: 'user1',
      actor: 'secretaria@carc.test',
      socioId: 'socio1',
      socioNombre: 'Juan Pérez',
      amount: 30000,
      concept: 'Evento: Trekking',
      categoria: 'Viajes',
      paymentMethod: 'Efectivo',
      description: 'Seña',
      date,
      sourceType: 'evento_participante',
      sourceId: 'part1',
      sourceModel: 'EventoParticipante',
      eventoId: '507f1f77bcf86cd799439099',
      session: sessionMock,
    });

    expect(movimiento.type).toBe('Ingreso');
    expect(movimiento.amount).toBe(30000);
    expect(movimiento.concept).toBe('Evento: Trekking');
    expect(movimiento.categoria).toBe('Viajes');
    expect(movimiento.responsable).toBe('secretaria@carc.test');
    expect(movimiento.createdBy).toBe('secretaria@carc.test');
    expect(movimiento.updatedBy).toBe('secretaria@carc.test');
    expect(movimiento.sourceType).toBe('evento_participante');
    expect(String(movimiento.eventoId)).toBe('507f1f77bcf86cd799439099');
    expect(saveSpy).toHaveBeenCalledWith({ session: sessionMock });
  });

  it('usa los defaults (socioId null, socioNombre vacío, categoria/eventoId null) cuando no vienen', async () => {
    const movimiento = await crearMovimientoDePago({
      clubId: 'club1',
      userId: 'user1',
      actor: 'a',
      amount: 1000,
      concept: 'Muro libre diario',
      paymentMethod: 'Efectivo',
      date: new Date(),
      sourceType: 'muro_libre',
      sourceId: new mongoose.Types.ObjectId(),
      sourceModel: 'Asistencia',
    });

    expect(movimiento.socioId).toBeNull();
    expect(movimiento.socioNombre).toBe('');
    expect(movimiento.categoria).toBeNull();
    expect(movimiento.eventoId).toBeFalsy();
  });
});
