import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { revertirCobro } from '../../services/reversers/revertirCobro.js';

const CLUB_ID = 'club1';
const ACTOR = 'admin@carc.test';
const session = {};

describe('revertirCobro', () => {
  let CobroModel;
  let MovimientoModel;
  let CuotaModel;

  beforeEach(() => {
    CobroModel = { findOne: vi.fn(), findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'cobro1' }) };
    MovimientoModel = { findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'mov1' }) };
    CuotaModel = { updateMany: vi.fn().mockResolvedValue(undefined) };

    vi.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Cobro') return CobroModel;
      if (name === 'Movimiento') return MovimientoModel;
      if (name === 'Cuota') return CuotaModel;
      throw new Error(`modelo no mockeado: ${name}`);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('CREATE: anula el cobro, el movimiento y marca las cuotas como anuladas', async () => {
    const cobro = {
      _id: 'cobro1',
      movimientoId: 'mov1',
      active: true,
      save: vi.fn().mockResolvedValue(undefined),
    };
    CobroModel.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const log = { clubId: CLUB_ID, resourceId: 'cobro1', action: 'CREATE' };
    await revertirCobro(log, { actor: ACTOR, session });

    expect(cobro.active).toBe(false);
    expect(cobro.anuladoPor).toBe(ACTOR);
    expect(cobro.save).toHaveBeenCalledWith({ session });
    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { active: false, updatedBy: ACTOR },
      { session },
    );
    expect(CuotaModel.updateMany).toHaveBeenCalledWith(
      { cobroId: 'cobro1', clubId: CLUB_ID },
      { estado: 'anulada', updatedBy: ACTOR },
      { session },
    );
  });

  it('appcarc-backend#221: CREATE lanza 422 si el cobro ya está anulado, en vez de no hacer nada en silencio', async () => {
    const cobro = { _id: 'cobro1', active: false, save: vi.fn() };
    CobroModel.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(cobro) });

    const log = { clubId: CLUB_ID, resourceId: 'cobro1', action: 'CREATE' };
    await expect(revertirCobro(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });

    expect(cobro.save).not.toHaveBeenCalled();
    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('appcarc-backend#221: CREATE lanza 422 si el cobro no existe, en vez de no hacer nada en silencio', async () => {
    CobroModel.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    const log = { clubId: CLUB_ID, resourceId: 'cobro1', action: 'CREATE' };
    await expect(revertirCobro(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });

    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('DELETE: restaura el cobro, reactiva el movimiento y las cuotas anuladas', async () => {
    const log = {
      clubId: CLUB_ID,
      resourceId: 'cobro1',
      action: 'DELETE',
      before: { movimientoId: 'mov1', active: true, anuladoAt: null, _id: 'cobro1', updatedAt: new Date() },
    };

    await revertirCobro(log, { actor: ACTOR, session });

    expect(CobroModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'cobro1', clubId: CLUB_ID },
      { $set: expect.objectContaining({ active: true, anuladoAt: null, updatedBy: ACTOR }) },
      { session },
    );
    expect(CobroModel.findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty('_id');
    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { active: true, updatedBy: ACTOR },
      { session },
    );
    expect(CuotaModel.updateMany).toHaveBeenCalledWith(
      { cobroId: 'cobro1', clubId: CLUB_ID, estado: 'anulada' },
      { estado: 'pagada', updatedBy: ACTOR },
      { session },
    );
  });

  it('DELETE: lanza error con status 422 si no hay snapshot before', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'cobro1', action: 'DELETE', before: null };

    await expect(revertirCobro(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });
  });

  it('DELETE: lanza 422 y no toca el movimiento ni las cuotas si el cobro no pertenece a este club (appcarc-backend#91, appcarc-backend#221)', async () => {
    CobroModel.findOneAndUpdate.mockResolvedValue(null);
    const log = {
      clubId: CLUB_ID,
      resourceId: 'cobro1',
      action: 'DELETE',
      before: { movimientoId: 'mov1', active: true, anuladoAt: null, _id: 'cobro1', updatedAt: new Date() },
    };

    await expect(revertirCobro(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });

    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(CuotaModel.updateMany).not.toHaveBeenCalled();
  });
});
