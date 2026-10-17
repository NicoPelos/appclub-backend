import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../../../services/permisosCache.js', () => ({
  tienePermiso: vi.fn(),
}));

import { getAsistenciasHandler } from '../../handlers/getAsistencias.handler.js';
import { createAsistenciaEscuelitaHandler } from '../../handlers/createAsistenciaEscuelita.handler.js';
import Asistencia from '../../models/Asistencia.js';
import * as socioQrService from '../../../socios/services/socioQr.service.js';
import * as registrarService from '../../services/registrarAsistenciaEscuelita.service.js';
import { tienePermiso } from '../../../../services/permisosCache.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const USER = { id: 'staff1', email: 'secretaria@carc.test', clubId: 'club1' };

describe('getAsistenciasHandler', () => {
  beforeEach(() => {
    Asistencia.countDocuments = vi.fn().mockResolvedValue(3);
    Asistencia.find = vi.fn().mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([
        { _id: 'a1', tipo: 'escuelita' },
        { _id: 'a2', tipo: 'muro_libre' },
      ]),
    });
    // Por defecto, el rol del USER de estos tests sí tiene muroLibre:read —
    // preserva el comportamiento de los tests existentes (staff con acceso
    // completo). Los tests de appcarc-backend#218 lo pisan a false aparte.
    tienePermiso.mockResolvedValue(true);
  });

  afterEach(() => vi.restoreAllMocks());

  it('should return paginated asistencias', async () => {
    const req = { query: {}, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 3 }));
  });

  it('should filter by tipo=escuelita', async () => {
    const req = { query: { tipo: 'escuelita' }, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({ tipo: 'escuelita' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should return 400 for invalid tipo', async () => {
    const req = { query: { tipo: 'invalido' }, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 for invalid socioId', async () => {
    const req = { query: { socioId: 'no-es-un-id' }, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should apply date range filter using Argentina timezone (UTC-3) for date-only bounds', async () => {
    const req = { query: { from: '2026-06-01', to: '2026-06-30' }, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({
      fecha: { $gte: new Date('2026-06-01T00:00:00-03:00'), $lte: new Date('2026-06-30T23:59:59.999-03:00') },
    }));
  });

  it('should return 500 on unexpected error', async () => {
    Asistencia.countDocuments.mockRejectedValue(new Error('DB down'));
    const req = { query: {}, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('should filter by own socioId when user role is only socio', async () => {
    const socioUser = { id: 'u1', roles: ['socio'], clubId: 'club1', socioId: '507f1f77bcf86cd799439011' };
    const req = { query: {}, user: socioUser };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({
      socioId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
    }));
  });

  it('should reject with 403 when a socio-only user requests another socio\'s socioId (appcarc-backend#88)', async () => {
    const socioUser = { id: 'u1', roles: ['socio'], clubId: 'club1', socioId: '507f1f77bcf86cd799439011' };
    const req = { query: { socioId: '507f1f77bcf86cd799439099' }, user: socioUser };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(Asistencia.find).not.toHaveBeenCalled();
  });

  it('should allow a socio-only user to request their own socioId explicitly', async () => {
    const socioUser = { id: 'u1', roles: ['socio'], clubId: 'club1', socioId: '507f1f77bcf86cd799439011' };
    const req = { query: { socioId: '507f1f77bcf86cd799439011' }, user: socioUser };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({
      socioId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439011'),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should let staff (non-socio-only) filter by any socioId', async () => {
    const req = { query: { socioId: '507f1f77bcf86cd799439099' }, user: USER };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({
      socioId: new mongoose.Types.ObjectId('507f1f77bcf86cd799439099'),
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  // appcarc-backend#218: ASISTENCIAS_READ no implica muroLibre:read — un rol
  // como "profesor" (tiene el primero, no el segundo) no debe poder ver
  // datos de muro libre vía este endpoint unificado.
  it('appcarc-backend#218: excluye muro_libre del listado cuando el rol no tiene muroLibre:read', async () => {
    tienePermiso.mockResolvedValue(false);
    const req = { query: {}, user: { ...USER, roles: ['profesor'] } };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({
      tipo: { $ne: 'muro_libre' },
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#218: 403 si pide explícitamente tipo=muro_libre sin muroLibre:read', async () => {
    tienePermiso.mockResolvedValue(false);
    const req = { query: { tipo: 'muro_libre' }, user: { ...USER, roles: ['profesor'] } };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(Asistencia.find).not.toHaveBeenCalled();
  });

  it('appcarc-backend#218: un rol con muroLibre:read sigue viendo todo sin filtrar', async () => {
    tienePermiso.mockResolvedValue(true);
    const req = { query: {}, user: { ...USER, roles: ['secretaria'] } };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.not.objectContaining({ tipo: expect.anything() }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-backend#218: un socio viendo su propio historial ve muro_libre aunque su rol no tenga el permiso', async () => {
    tienePermiso.mockResolvedValue(false);
    const socioUser = { id: 'u1', roles: ['socio'], clubId: 'club1', socioId: '507f1f77bcf86cd799439011' };
    const req = { query: {}, user: socioUser };
    const res = mockRes();

    await getAsistenciasHandler(req, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.not.objectContaining({ tipo: expect.anything() }));
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe('createAsistenciaEscuelitaHandler', () => {
  const SOCIO_ID = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    vi.spyOn(registrarService, 'registrarAsistenciaEscuelita').mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      tipo: 'escuelita',
    });
    vi.spyOn(socioQrService, 'resolveSocioFromQrTokenOrDni').mockResolvedValue({
      socio: { _id: SOCIO_ID },
      method: 'QR',
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should register attendance using socioId directly', async () => {
    const req = { body: { socioId: SOCIO_ID, categoria: 'niños' }, user: USER };
    const res = mockRes();

    await createAsistenciaEscuelitaHandler(req, res);

    expect(registrarService.registrarAsistenciaEscuelita).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ socioId: SOCIO_ID }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should register attendance resolving socioId from QR token', async () => {
    const req = { body: { token: 'qr-token', categoria: 'adultos' }, user: USER };
    const res = mockRes();

    await createAsistenciaEscuelitaHandler(req, res);

    expect(socioQrService.resolveSocioFromQrTokenOrDni).toHaveBeenCalledWith(expect.objectContaining({
      token: 'qr-token',
      clubId: 'club1',
    }));
    expect(registrarService.registrarAsistenciaEscuelita).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ socioId: SOCIO_ID }),
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should return 400 when neither token, dni nor socioId provided', async () => {
    const req = { body: { categoria: 'niños' }, user: USER };
    const res = mockRes();

    await createAsistenciaEscuelitaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Se requiere token QR, DNI o socioId' });
  });

  it('should return error status from BusinessError', async () => {
    vi.spyOn(registrarService, 'registrarAsistenciaEscuelita').mockRejectedValue(
      Object.assign(new Error('El socio no está inscripto activamente en la escuelita'), { status: 400 }),
    );
    const req = { body: { socioId: SOCIO_ID }, user: USER };
    const res = mockRes();

    await createAsistenciaEscuelitaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'El socio no está inscripto activamente en la escuelita' });
  });
});
