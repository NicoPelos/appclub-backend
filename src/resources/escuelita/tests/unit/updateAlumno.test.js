import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { updateAlumnoHandler } from '../../handlers/updateAlumno.handler.js';
import Escuelita from '../../models/Escuelita.js';

vi.mock('../../services/sincronizarSuscripcionPlan.service.js', () => ({
  sincronizarSuscripcionEscuelita: vi.fn(),
}));

import { sincronizarSuscripcionEscuelita } from '../../services/sincronizarSuscripcionPlan.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const ALUMNO_ID = '507f1f77bcf86cd799439011';
const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };

const buildAlumno = (overrides = {}) => ({
  _id: ALUMNO_ID,
  socioId: 'socio1',
  populate: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({}),
  ...overrides,
});

describe('updateAlumnoHandler', () => {
  beforeEach(() => {
    Escuelita.findOne = vi.fn();
    Escuelita.findOneAndUpdate = vi.fn();
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: vi.fn(async (cb) => cb()),
      endSession: vi.fn(),
    });
    sincronizarSuscripcionEscuelita.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it('devuelve 400 si fechaInscripcion es inválida', async () => {
    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { fechaInscripcion: 'no-es-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 404 si el alumno no existe', async () => {
    Escuelita.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { observaciones: 'x' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('actualiza sin planId y no llama al sync', async () => {
    Escuelita.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ALUMNO_ID }) });
    Escuelita.findOneAndUpdate.mockResolvedValue(buildAlumno());

    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { observaciones: 'nueva' }, user: USER }, res);

    expect(sincronizarSuscripcionEscuelita).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('actualiza con planId y sincroniza la Suscripcion', async () => {
    Escuelita.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ALUMNO_ID }) });
    const alumno = buildAlumno();
    Escuelita.findOneAndUpdate.mockResolvedValue(alumno);

    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { planId: 'plan1' }, user: USER }, res);

    expect(sincronizarSuscripcionEscuelita).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'club1', socioId: 'socio1', planId: 'plan1',
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('desasignar el plan (planId null) también dispara el sync', async () => {
    Escuelita.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ALUMNO_ID }) });
    Escuelita.findOneAndUpdate.mockResolvedValue(buildAlumno());

    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { planId: null }, user: USER }, res);

    expect(sincronizarSuscripcionEscuelita).toHaveBeenCalledWith(expect.objectContaining({ planId: null }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('propaga el status de error del sync (ej. 400 plan inválido)', async () => {
    Escuelita.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ALUMNO_ID }) });
    Escuelita.findOneAndUpdate.mockResolvedValue(buildAlumno());
    const error = new Error('El plan indicado no existe, está inactivo o no es de tipo escuelita');
    error.status = 400;
    sincronizarSuscripcionEscuelita.mockRejectedValue(error);

    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { planId: 'plan-invalido' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 500 ante un error inesperado', async () => {
    Escuelita.findOne.mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB down')) });
    const res = mockRes();
    await updateAlumnoHandler({ params: { id: ALUMNO_ID }, body: { observaciones: 'x' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
