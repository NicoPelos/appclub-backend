import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { revertirMovimiento } from '../../services/reversers/revertirMovimiento.js';

const CLUB_ID = 'club1';
const ACTOR = 'admin@carc.test';
const session = {};

describe('revertirMovimiento', () => {
  let MovimientoModel;
  let CobroModel;
  let CuotaModel;
  let AsistenciaModel;

  beforeEach(() => {
    MovimientoModel = { findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'mov1' }) };
    CobroModel = { findOne: vi.fn() };
    CuotaModel = { updateMany: vi.fn().mockResolvedValue(undefined) };
    AsistenciaModel = { findOneAndUpdate: vi.fn().mockResolvedValue(undefined) };

    vi.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Movimiento') return MovimientoModel;
      if (name === 'Cobro') return CobroModel;
      if (name === 'Cuota') return CuotaModel;
      if (name === 'Asistencia') return AsistenciaModel;
      throw new Error(`modelo no mockeado: ${name}`);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('CREATE: soft-delete genérico, sin cascada', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'mov1', action: 'CREATE' };
    await revertirMovimiento(log, { actor: ACTOR, session });

    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { $set: { active: false, updatedBy: ACTOR } },
      { session },
    );
    expect(CobroModel.findOne).not.toHaveBeenCalled();
  });

  it('appcarc-backend#221: CREATE lanza 422 si el movimiento no pertenece a este club, en vez de no hacer nada en silencio', async () => {
    MovimientoModel.findOneAndUpdate.mockResolvedValue(null);
    const log = { clubId: CLUB_ID, resourceId: 'mov1', action: 'CREATE' };
    await expect(revertirMovimiento(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });
  });

  it('UPDATE: restaura los campos propios, sin tocar el origen', async () => {
    const log = {
      clubId: CLUB_ID,
      resourceId: 'mov1',
      action: 'UPDATE',
      before: { amount: 100, sourceModel: 'Cobro', sourceId: 'cobro1' },
    };

    await revertirMovimiento(log, { actor: ACTOR, session });

    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { $set: expect.objectContaining({ amount: 100, updatedBy: ACTOR }) },
      { session },
    );
    expect(CobroModel.findOne).not.toHaveBeenCalled();
  });

  it('DELETE: reactiva el Cobro de origen y sus cuotas anuladas', async () => {
    const cobro = { _id: 'cobro1', active: false, save: vi.fn().mockResolvedValue(undefined) };
    CobroModel.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const log = {
      clubId: CLUB_ID,
      resourceId: 'mov1',
      action: 'DELETE',
      before: { active: true, sourceModel: 'Cobro', sourceId: 'cobro1' },
    };

    await revertirMovimiento(log, { actor: ACTOR, session });

    expect(cobro.active).toBe(true);
    expect(cobro.anuladoAt).toBeNull();
    expect(cobro.save).toHaveBeenCalledWith({ session });
    expect(CuotaModel.updateMany).toHaveBeenCalledWith(
      { cobroId: 'cobro1', clubId: CLUB_ID, estado: 'anulada' },
      { estado: 'pagada', updatedBy: ACTOR },
      { session },
    );
  });

  it('DELETE: no reactiva el Cobro si ya estaba activo por otra vía', async () => {
    const cobro = { _id: 'cobro1', active: true, save: vi.fn() };
    CobroModel.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const log = {
      clubId: CLUB_ID,
      resourceId: 'mov1',
      action: 'DELETE',
      before: { active: true, sourceModel: 'Cobro', sourceId: 'cobro1' },
    };

    await revertirMovimiento(log, { actor: ACTOR, session });

    expect(cobro.save).not.toHaveBeenCalled();
    expect(CuotaModel.updateMany).not.toHaveBeenCalled();
  });

  it('DELETE: reactiva la Asistencia (muro libre) de origen', async () => {
    const log = {
      clubId: CLUB_ID,
      resourceId: 'mov1',
      action: 'DELETE',
      before: { active: true, sourceModel: 'Asistencia', sourceId: 'asis1' },
    };

    await revertirMovimiento(log, { actor: ACTOR, session });

    expect(AsistenciaModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'asis1', clubId: CLUB_ID },
      { active: true, updatedBy: ACTOR },
      { session },
    );
  });

  it('DELETE: lanza error con status 422 si no hay snapshot before', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'mov1', action: 'DELETE', before: null };
    await expect(revertirMovimiento(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });
  });

  it('DELETE: lanza 422 y no reactiva el origen si el movimiento no pertenece a este club (appcarc-backend#91, appcarc-backend#221)', async () => {
    MovimientoModel.findOneAndUpdate.mockResolvedValue(null);
    const log = {
      clubId: CLUB_ID,
      resourceId: 'mov1',
      action: 'DELETE',
      before: { active: true, sourceModel: 'Asistencia', sourceId: 'asis1' },
    };

    await expect(revertirMovimiento(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });

    expect(AsistenciaModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
