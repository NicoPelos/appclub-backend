import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { revertirMuroLibre } from '../../services/reversers/revertirMuroLibre.js';

const CLUB_ID = 'club1';
const ACTOR = 'admin@carc.test';
const session = {};

describe('revertirMuroLibre', () => {
  let AsistenciaModel;
  let MovimientoModel;

  beforeEach(() => {
    AsistenciaModel = { findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'asis1' }) };
    MovimientoModel = { findOneAndUpdate: vi.fn().mockResolvedValue({ _id: 'mov1' }) };

    vi.spyOn(mongoose, 'model').mockImplementation((name) => {
      if (name === 'Asistencia') return AsistenciaModel;
      if (name === 'Movimiento') return MovimientoModel;
      throw new Error(`modelo no mockeado: ${name}`);
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('CREATE: soft-delete el registro y desactiva el movimiento vinculado (pase pagado)', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'asis1', action: 'CREATE', after: { movimientoId: 'mov1' } };
    await revertirMuroLibre(log, { actor: ACTOR, session });

    expect(AsistenciaModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'asis1', clubId: CLUB_ID },
      { $set: { active: false, updatedBy: ACTOR } },
      { session },
    );
    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { active: false, updatedBy: ACTOR },
      { session },
    );
  });

  it('CREATE: sin movimiento vinculado (pase no pagado), no toca Movimiento', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'asis1', action: 'CREATE', after: { movimientoId: null } };
    await revertirMuroLibre(log, { actor: ACTOR, session });

    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('CREATE: lanza 422 y no toca el movimiento si la asistencia no pertenece a este club (appcarc-backend#91, appcarc-backend#221)', async () => {
    AsistenciaModel.findOneAndUpdate.mockResolvedValue(null);
    const log = { clubId: CLUB_ID, resourceId: 'asis1', action: 'CREATE', after: { movimientoId: 'mov1' } };
    await expect(revertirMuroLibre(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });

    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('UPDATE: restaura el registro y sincroniza monto/formaPago en el movimiento vinculado', async () => {
    const log = {
      clubId: CLUB_ID,
      resourceId: 'asis1',
      action: 'UPDATE',
      before: { monto: 500, formaPago: 'Efectivo', movimientoId: 'mov1' },
    };

    await revertirMuroLibre(log, { actor: ACTOR, session });

    expect(AsistenciaModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'asis1', clubId: CLUB_ID },
      { $set: expect.objectContaining({ monto: 500, formaPago: 'Efectivo', updatedBy: ACTOR }) },
      { session },
    );
    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { $set: { amount: 500, paymentMethod: 'Efectivo', updatedBy: ACTOR } },
      { session },
    );
  });

  it('DELETE: restaura el registro y reactiva el movimiento vinculado', async () => {
    const log = {
      clubId: CLUB_ID,
      resourceId: 'asis1',
      action: 'DELETE',
      before: { active: true, movimientoId: 'mov1' },
    };

    await revertirMuroLibre(log, { actor: ACTOR, session });

    expect(MovimientoModel.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'mov1', clubId: CLUB_ID },
      { active: true, updatedBy: ACTOR },
      { session },
    );
  });

  it('DELETE: sin movimiento vinculado, no intenta tocar Movimiento', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'asis1', action: 'DELETE', before: { active: true, movimientoId: null } };
    await revertirMuroLibre(log, { actor: ACTOR, session });

    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('UPDATE/DELETE: lanza error con status 422 si no hay snapshot before', async () => {
    const log = { clubId: CLUB_ID, resourceId: 'asis1', action: 'UPDATE', before: null };
    await expect(revertirMuroLibre(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });
  });

  it('UPDATE: lanza 422 y no toca el movimiento si la asistencia no pertenece a este club (appcarc-backend#91, appcarc-backend#221)', async () => {
    AsistenciaModel.findOneAndUpdate.mockResolvedValue(null);
    const log = {
      clubId: CLUB_ID,
      resourceId: 'asis1',
      action: 'UPDATE',
      before: { monto: 500, formaPago: 'Efectivo', movimientoId: 'mov1' },
    };

    await expect(revertirMuroLibre(log, { actor: ACTOR, session })).rejects.toMatchObject({ status: 422 });

    expect(MovimientoModel.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
