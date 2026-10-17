import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRolHandler } from '../../handlers/createRol.handler.js';

const mockSave = vi.fn();

vi.mock('../../models/Rol.js', () => ({
  default: {
    findOne: vi.fn(),
    ...({ default: vi.fn() }),
  },
}));

vi.mock('../../models/Rol.js', () => ({
  default: Object.assign(
    vi.fn().mockImplementation((data) => ({ ...data, save: mockSave })),
    { findOne: vi.fn() },
  ),
}));

vi.mock('../../../services/permisosCache.js', () => ({ invalidarClub: vi.fn() }));

import Rol from '../../models/Rol.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('createRolHandler', () => {
  it('crea rol correctamente (201)', async () => {
    Rol.findOne.mockResolvedValue(null);
    mockSave.mockResolvedValue();

    const req = { user: mockUser, body: { nombre: 'entrenador', permisos: ['socios:read'] } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(mockSave).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('genera un slug a partir del nombre', async () => {
    Rol.findOne.mockResolvedValue(null);
    mockSave.mockResolvedValue();

    const req = { user: mockUser, body: { nombre: 'Profesor Senior' } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(Rol).toHaveBeenCalledWith(expect.objectContaining({ slug: 'profesor-senior' }));
  });

  it('desambigua el slug si ya existe uno igual en el club', async () => {
    Rol.findOne
      .mockResolvedValueOnce(null) // chequeo de nombre duplicado en el handler
      .mockResolvedValueOnce({ slug: 'entrenador' }) // generarSlugUnico: "entrenador" ocupado
      .mockResolvedValueOnce(null); // "entrenador-2" libre
    mockSave.mockResolvedValue();

    const req = { user: mockUser, body: { nombre: 'Entrenador' } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(Rol).toHaveBeenCalledWith(expect.objectContaining({ slug: 'entrenador-2' }));
  });

  it('retorna 400 si falta nombre', async () => {
    const req = { user: mockUser, body: {} };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('nombre') }));
  });

  it('retorna 400 si hay permisos inválidos', async () => {
    const req = { user: mockUser, body: { nombre: 'test', permisos: ['permiso:inexistente'] } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('inválidos') }));
  });

  it('retorna 409 si el rol ya existe', async () => {
    Rol.findOne.mockResolvedValue({ nombre: 'entrenador' });

    const req = { user: mockUser, body: { nombre: 'entrenador' } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('el chequeo de duplicados filtra por active: true (no bloquea reutilizar el nombre de un rol borrado)', async () => {
    Rol.findOne.mockResolvedValue(null);
    mockSave.mockResolvedValue();

    const req = { user: mockUser, body: { nombre: 'entrenador' } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(Rol.findOne).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'entrenador', active: true }));
  });

  it('retorna 500 si hay error de BD', async () => {
    Rol.findOne.mockRejectedValue(new Error('DB error'));

    const req = { user: mockUser, body: { nombre: 'entrenador' } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it.each([[null], ['socios:read'], [{}]])('#161: devuelve 400 (no revienta) si permisos no es un array (%j)', async (permisos) => {
    const res = mockRes();
    await createRolHandler({ user: mockUser, body: { nombre: 'Tesorera', permisos } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'permisos debe ser un array' });
  });

  it.each([[{ $ne: 'admin' }], [123], [['a']], [true]])(
    'appcarc-backend#226: devuelve 400 (no 500) si nombre no es un string (%j)',
    async (nombre) => {
      const res = mockRes();
      await createRolHandler({ user: mockUser, body: { nombre } }, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(Rol.findOne).not.toHaveBeenCalled();
    },
  );

  it('appcarc-backend#226: devuelve 400 si nombre es solo espacios', async () => {
    const res = mockRes();
    await createRolHandler({ user: mockUser, body: { nombre: '   ' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('appcarc-backend#226: guarda el nombre trimeado ("Admin " -> "Admin")', async () => {
    Rol.findOne.mockResolvedValue(null);
    mockSave.mockResolvedValue();

    const req = { user: mockUser, body: { nombre: '  Admin  ' } };
    await createRolHandler(req, mockRes());

    expect(Rol).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Admin' }));
  });

  it('appcarc-backend#227: devuelve 409 (no 500) si save() choca con el índice único por una carrera (E11000)', async () => {
    Rol.findOne.mockResolvedValue(null);
    const dupError = new Error('duplicate key');
    dupError.code = 11000;
    mockSave.mockRejectedValue(dupError);

    const req = { user: mockUser, body: { nombre: 'entrenador' } };
    const res = mockRes();
    await createRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
  });
});
