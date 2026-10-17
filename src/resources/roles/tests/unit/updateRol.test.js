import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateRolHandler } from '../../handlers/updateRol.handler.js';

vi.mock('../../models/Rol.js', () => ({ default: { findOne: vi.fn() } }));
vi.mock('../../../services/permisosCache.js', () => ({ invalidarClub: vi.fn() }));

import Rol from '../../models/Rol.js';

const mockUser = { clubId: 'CARC' };
const VALID_ID = '507f1f77bcf86cd799439011';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const makeRol = (overrides = {}) => ({
  nombre: 'palestrero',
  permisos: ['muroLibre:read'],
  save: vi.fn().mockResolvedValue(),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('updateRolHandler', () => {
  it('actualiza permisos correctamente (200)', async () => {
    const rol = makeRol();
    Rol.findOne.mockResolvedValue(rol);

    const req = { user: mockUser, params: { id: VALID_ID }, body: { permisos: ['socios:read', 'muroLibre:read'] } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(rol.permisos).toEqual(['socios:read', 'muroLibre:read']);
    expect(rol.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('actualiza nombre correctamente', async () => {
    const rol = makeRol();
    Rol.findOne
      .mockResolvedValueOnce(rol) // busca el rol a editar
      .mockResolvedValueOnce(null); // chequeo de nombre duplicado: libre

    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: 'entrenador' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(rol.nombre).toBe('entrenador');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('no consulta duplicados si el nombre no cambia', async () => {
    const rol = makeRol();
    Rol.findOne.mockResolvedValueOnce(rol);

    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: 'palestrero', permisos: ['socios:read'] } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(Rol.findOne).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 400 si el nombre viene vacío', async () => {
    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: '' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('nombre') }));
  });

  it('retorna 409 si ya existe otro rol con ese nombre', async () => {
    const rol = makeRol();
    Rol.findOne
      .mockResolvedValueOnce(rol) // busca el rol a editar
      .mockResolvedValueOnce({ nombre: 'secretaria' }); // ya hay otro rol con ese nombre

    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: 'secretaria' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(rol.nombre).toBe('palestrero'); // no se modificó
    expect(rol.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('retorna 400 si hay permisos inválidos', async () => {
    const req = { user: mockUser, params: { id: VALID_ID }, body: { permisos: ['permiso:falso'] } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('inválidos') }));
  });

  it('retorna 404 si el rol no existe', async () => {
    Rol.findOne.mockResolvedValue(null);

    const req = { user: mockUser, params: { id: 'noexiste' }, body: { nombre: 'x' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('retorna 500 si hay error de BD', async () => {
    Rol.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: 'x' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it.each([[null], ['socios:read'], [{}]])('#161: devuelve 400 (no revienta) si permisos no es un array (%j)', async (permisos) => {
    const res = mockRes();
    await updateRolHandler({ user: mockUser, params: { id: VALID_ID }, body: { permisos } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'permisos debe ser un array' });
  });

  it.each([[{ $ne: 'admin' }], [123], [true]])(
    'appcarc-backend#226: devuelve 400 (no 500) si nombre no es un string (%j)',
    async (nombre) => {
      const res = mockRes();
      await updateRolHandler({ user: mockUser, params: { id: VALID_ID }, body: { nombre } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(Rol.findOne).not.toHaveBeenCalled();
    },
  );

  it('appcarc-backend#226: devuelve 400 si nombre es solo espacios', async () => {
    const res = mockRes();
    await updateRolHandler({ user: mockUser, params: { id: VALID_ID }, body: { nombre: '   ' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('appcarc-backend#226: guarda el nombre trimeado', async () => {
    const rol = makeRol();
    Rol.findOne.mockResolvedValueOnce(rol).mockResolvedValueOnce(null);

    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: '  entrenador  ' } };
    await updateRolHandler(req, mockRes());

    expect(rol.nombre).toBe('entrenador');
  });

  it('appcarc-backend#227: devuelve 404 (no 500) si el :id no es un ObjectId válido', async () => {
    const req = { user: mockUser, params: { id: 'no-es-un-id' }, body: { nombre: 'x' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(Rol.findOne).not.toHaveBeenCalled();
  });

  it('appcarc-backend#227: devuelve 409 (no 500) si save() choca con el índice único por una carrera (E11000)', async () => {
    const dupError = new Error('duplicate key');
    dupError.code = 11000;
    const rol = makeRol({ save: vi.fn().mockRejectedValue(dupError) });
    Rol.findOne.mockResolvedValueOnce(rol).mockResolvedValueOnce(null);

    const req = { user: mockUser, params: { id: VALID_ID }, body: { nombre: 'entrenador' } };
    const res = mockRes();
    await updateRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});
