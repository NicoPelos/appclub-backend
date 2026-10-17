import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import {
  BusinessError,
  registrarAsistenciaEscuelita,
} from '../../services/registrarAsistenciaEscuelita.service.js';
import Socio from '../../../socios/models/Socio.js';
import Escuelita from '../../../escuelita/models/Escuelita.js';
import Asistencia from '../../models/Asistencia.js';

const CLUB_ID = 'club1';
const SOCIO_ID = '507f1f77bcf86cd799439011';
const USER = { id: 'staff1', email: 'secretaria@carc.test' };

const mockSocioQuery = (result) => {
  Socio.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(result) });
};

const mockEscuelitaQuery = (result) => {
  Escuelita.findOne.mockReturnValue({ session: vi.fn().mockResolvedValue(result) });
};

describe('registrarAsistenciaEscuelita service (unit)', () => {
  let sessionMock;
  let saveSpy;
  let saved;

  beforeEach(() => {
    saved = [];
    sessionMock = {
      withTransaction: vi.fn(async (cb) => cb()),
      endSession: vi.fn(),
    };
    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);

    Socio.findOne = vi.fn();
    Escuelita.findOne = vi.fn();

    saveSpy = vi.spyOn(Asistencia.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      saved.push(this);
      return this;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should fail with 401 when clubId is missing', async () => {
    await expect(registrarAsistenciaEscuelita({
      clubId: undefined,
      user: USER,
      body: { socioId: SOCIO_ID },
    })).rejects.toMatchObject({ status: 401 });

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should fail with 400 when socioId is missing', async () => {
    await expect(registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: {},
    })).rejects.toMatchObject({ message: 'El socioId es obligatorio' });
  });

  it('should fail with 400 when socioId is not a valid ObjectId', async () => {
    await expect(registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: 'no-es-id' },
    })).rejects.toMatchObject({ message: 'El socioId no es válido' });
  });

  it('should fail with 400 when fecha is invalid', async () => {
    await expect(registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: SOCIO_ID, fecha: 'no-es-fecha' },
    })).rejects.toMatchObject({ message: 'La fecha no es válida' });
  });

  it('appcarc-backend#167: should fail with 400 when fecha is in the future', async () => {
    await expect(registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: SOCIO_ID, fecha: '2099-01-01T12:00:00.000Z' },
    })).rejects.toMatchObject({ message: 'La fecha de la asistencia no puede ser futura' });

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should fail with 404 when socio does not exist', async () => {
    mockSocioQuery(null);

    await expect(registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: SOCIO_ID },
    })).rejects.toMatchObject({ status: 404 });

    expect(Escuelita.findOne).not.toHaveBeenCalled();
  });

  it('should fail with 400 when socio is not enrolled in escuelita', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678', clubId: CLUB_ID });
    mockEscuelitaQuery(null);

    await expect(registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: SOCIO_ID },
    })).rejects.toMatchObject({ message: 'El socio no está inscripto activamente en la escuelita' });

    expect(saveSpy).not.toHaveBeenCalled();
  });

  it('should register attendance for an active alumno', async () => {
    const socio = { _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' };
    mockSocioQuery(socio);
    mockEscuelitaQuery({ _id: new mongoose.Types.ObjectId(), estado: 'activo' });

    const result = await registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: SOCIO_ID, categoria: 'niños', observaciones: 'Llegó tarde' },
    });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(saved[0]).toMatchObject({
      tipo: 'escuelita',
      esSocio: true,
      nombre: 'Ana',
      apellido: 'García',
      categoria: 'niños',
      observaciones: 'Llegó tarde',
      createdBy: USER.email,
    });
    expect(result).toBe(saved[0]);
    expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
  });

  it('should use provided fecha and default categoria to empty string', async () => {
    const socio = { _id: SOCIO_ID, nombre: 'Luis', apellido: 'Paz', dni: '99999999' };
    mockSocioQuery(socio);
    mockEscuelitaQuery({ _id: new mongoose.Types.ObjectId(), estado: 'activo' });

    const fecha = '2026-05-10T10:00:00.000Z';
    await registrarAsistenciaEscuelita({
      clubId: CLUB_ID,
      user: USER,
      body: { socioId: SOCIO_ID, fecha },
    });

    expect(saved[0].fecha).toEqual(new Date(fecha));
    expect(saved[0].categoria).toBe('');
  });
});
