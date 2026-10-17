import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { createAlumnoHandler } from '../../handlers/createAlumno.handler.js';
import Socio from '../../../socios/models/Socio.js';
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

const SOCIO_ID = '507f1f77bcf86cd799439011';
const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };
const FAKE_SOCIO = { _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' };

describe('createAlumnoHandler', () => {
  beforeEach(() => {
    Socio.findOne = vi.fn();
    Escuelita.findOne = vi.fn();
    vi.spyOn(Escuelita.prototype, 'save').mockResolvedValue(undefined);
    vi.spyOn(Escuelita.prototype, 'populate').mockResolvedValue(undefined);
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: vi.fn(async (cb) => cb()),
      endSession: vi.fn(),
    });
    sincronizarSuscripcionEscuelita.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 400 when socioId is missing', async () => {
    const res = mockRes();
    await createAlumnoHandler({ body: {}, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'socioId es obligatorio' });
    expect(Socio.findOne).not.toHaveBeenCalled();
  });

  it('should return 404 when socio does not exist or is inactive', async () => {
    Socio.findOne.mockResolvedValue(null);
    const res = mockRes();
    await createAlumnoHandler({ body: { socioId: SOCIO_ID }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      message: 'El socio no existe, está inactivo o pertenece a otro club',
    });
    expect(Escuelita.findOne).not.toHaveBeenCalled();
  });

  it('should return 409 when socio is already enrolled', async () => {
    Socio.findOne.mockResolvedValue(FAKE_SOCIO);
    Escuelita.findOne.mockResolvedValue({ _id: 'existing', socioId: SOCIO_ID });
    const res = mockRes();
    await createAlumnoHandler({ body: { socioId: SOCIO_ID }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ message: 'El socio ya está inscripto en escuelita' });
    expect(Escuelita.prototype.save).not.toHaveBeenCalled();
  });

  it('should return 400 when fechaInscripcion is invalid', async () => {
    Socio.findOne.mockResolvedValue(FAKE_SOCIO);
    Escuelita.findOne.mockResolvedValue(null);
    const res = mockRes();
    await createAlumnoHandler(
      { body: { socioId: SOCIO_ID, fechaInscripcion: 'no-es-fecha' }, user: USER },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'La fecha de inscripción es inválida' });
    expect(Escuelita.prototype.save).not.toHaveBeenCalled();
  });

  it('should create alumno and return 201', async () => {
    Socio.findOne.mockResolvedValue(FAKE_SOCIO);
    Escuelita.findOne.mockResolvedValue(null);
    const res = mockRes();
    await createAlumnoHandler({ body: { socioId: SOCIO_ID }, user: USER }, res);

    expect(Escuelita.prototype.save).toHaveBeenCalledTimes(1);
    expect(Escuelita.prototype.populate).toHaveBeenCalledTimes(2);
    expect(sincronizarSuscripcionEscuelita).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should sync the Suscripcion when created with a planId', async () => {
    Socio.findOne.mockResolvedValue(FAKE_SOCIO);
    Escuelita.findOne.mockResolvedValue(null);
    const res = mockRes();
    await createAlumnoHandler({ body: { socioId: SOCIO_ID, planId: 'plan1' }, user: USER }, res);

    expect(sincronizarSuscripcionEscuelita).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'club1', planId: 'plan1',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should propagate a sync error status (ej. plan inválido)', async () => {
    Socio.findOne.mockResolvedValue(FAKE_SOCIO);
    Escuelita.findOne.mockResolvedValue(null);
    const error = new Error('El plan indicado no existe, está inactivo o no es de tipo escuelita');
    error.status = 400;
    sincronizarSuscripcionEscuelita.mockRejectedValue(error);

    const res = mockRes();
    await createAlumnoHandler({ body: { socioId: SOCIO_ID, planId: 'plan-invalido' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 500 on unexpected error', async () => {
    Socio.findOne.mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await createAlumnoHandler({ body: { socioId: SOCIO_ID }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
