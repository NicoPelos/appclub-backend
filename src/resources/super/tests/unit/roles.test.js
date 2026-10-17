import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSave = vi.fn();

vi.mock('../../../roles/models/Rol.js', () => ({
  default: Object.assign(
    vi.fn().mockImplementation((data) => ({ ...data, save: mockSave })),
    { find: vi.fn(), findOne: vi.fn() },
  ),
}));

vi.mock('../../../../services/permisosCache.js', () => ({ invalidarClub: vi.fn() }));
vi.mock('../../../usuarios/models/User.js', () => ({
  default: { exists: vi.fn() },
}));

import Rol from '../../../roles/models/Rol.js';
import User from '../../../usuarios/models/User.js';
import { invalidarClub } from '../../../../services/permisosCache.js';
import { getSuperRolesHandler } from '../../handlers/getSuperRoles.handler.js';
import { createSuperRolHandler } from '../../handlers/createSuperRol.handler.js';
import { updateSuperRolHandler } from '../../handlers/updateSuperRol.handler.js';
import { deleteSuperRolHandler } from '../../handlers/deleteSuperRol.handler.js';
import { getPermisosCatalogoHandler } from '../../handlers/getPermisosCatalogo.handler.js';
import { PERMISOS, TODOS_LOS_PERMISOS, PERMISOS_POR_CATEGORIA } from '../../../../constants/permisos.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => vi.clearAllMocks());

describe('getSuperRolesHandler', () => {
  it('devuelve 400 si falta clubId', async () => {
    const req = { query: {} };
    const res = mockRes();
    await getSuperRolesHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('lista los roles activos del club pedido', async () => {
    const roles = [{ nombre: 'admin', permisos: [] }];
    Rol.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(roles) }) });

    const req = { query: { clubId: 'CARC' } };
    const res = mockRes();
    await getSuperRolesHandler(req, res);

    expect(Rol.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(roles);
  });
});

describe('createSuperRolHandler', () => {
  it('devuelve 400 si falta clubId o nombre', async () => {
    const req = { body: { nombre: 'entrenador' } };
    const res = mockRes();
    await createSuperRolHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('crea el rol para el club indicado (201)', async () => {
    Rol.findOne.mockResolvedValue(null);
    mockSave.mockResolvedValue();

    const req = { body: { clubId: 'CARC', nombre: 'entrenador', permisos: [PERMISOS.SOCIOS_READ] } };
    const res = mockRes();
    await createSuperRolHandler(req, res);

    expect(Rol).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', nombre: 'entrenador' }));
    expect(res.status).toHaveBeenCalledWith(201);
    expect(invalidarClub).toHaveBeenCalledWith('CARC');
  });

  it('devuelve 400 si hay permisos inválidos', async () => {
    const req = { body: { clubId: 'CARC', nombre: 'entrenador', permisos: ['no:existe'] } };
    const res = mockRes();
    await createSuperRolHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 400 (no revienta el proceso) si permisos no es un array', async () => {
    const req = { body: { clubId: 'CARC', nombre: 'entrenador', permisos: 'admin' } };
    const res = mockRes();
    await expect(createSuperRolHandler(req, res)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Rol.findOne).not.toHaveBeenCalled();
  });

  it('devuelve 409 si el rol ya existe en ese club', async () => {
    Rol.findOne.mockResolvedValue({ nombre: 'entrenador' });
    const req = { body: { clubId: 'CARC', nombre: 'entrenador' } };
    const res = mockRes();
    await createSuperRolHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('permite recrear un rol con el mismo nombre que uno eliminado (soft-delete)', async () => {
    Rol.findOne.mockResolvedValue(null); // el índice único es parcial (solo entre activos)
    mockSave.mockResolvedValue();

    const req = { body: { clubId: 'CARC', nombre: 'entrenador' } };
    const res = mockRes();
    await createSuperRolHandler(req, res);

    expect(Rol.findOne).toHaveBeenCalledWith({ clubId: 'CARC', nombre: 'entrenador', active: true });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('updateSuperRolHandler', () => {
  it('devuelve 404 si el rol no existe', async () => {
    Rol.findOne.mockResolvedValue(null);
    const req = { params: { id: 'x' }, body: { nombre: 'nuevo' } };
    const res = mockRes();
    await updateSuperRolHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('actualiza nombre y permisos, invalida el cache del club del rol', async () => {
    const rol = { _id: 'r1', clubId: 'CARC', nombre: 'viejo', permisos: [], save: vi.fn() };
    Rol.findOne.mockResolvedValueOnce(rol).mockResolvedValueOnce(null); // 1: buscar por id, 2: chequeo de duplicado

    const req = { params: { id: 'r1' }, body: { nombre: 'nuevo', permisos: [PERMISOS.SOCIOS_READ] } };
    const res = mockRes();
    await updateSuperRolHandler(req, res);

    expect(rol.nombre).toBe('nuevo');
    expect(rol.permisos).toEqual([PERMISOS.SOCIOS_READ]);
    expect(rol.save).toHaveBeenCalled();
    expect(invalidarClub).toHaveBeenCalledWith('CARC');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('devuelve 409 si el nuevo nombre ya lo usa otro rol activo del mismo club', async () => {
    const rol = { _id: 'r1', clubId: 'CARC', nombre: 'viejo', permisos: [], save: vi.fn() };
    const otroRol = { _id: 'r2', clubId: 'CARC', nombre: 'nuevo' };
    Rol.findOne.mockResolvedValueOnce(rol).mockResolvedValueOnce(otroRol);

    const req = { params: { id: 'r1' }, body: { nombre: 'nuevo' } };
    const res = mockRes();
    await updateSuperRolHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(rol.nombre).toBe('viejo');
    expect(rol.save).not.toHaveBeenCalled();
  });

  it('no chequea duplicado si el nombre no cambió', async () => {
    const rol = { _id: 'r1', clubId: 'CARC', nombre: 'igual', permisos: [], save: vi.fn() };
    Rol.findOne.mockResolvedValueOnce(rol);

    const req = { params: { id: 'r1' }, body: { nombre: 'igual' } };
    const res = mockRes();
    await updateSuperRolHandler(req, res);

    expect(Rol.findOne).toHaveBeenCalledTimes(1);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('devuelve 400 si hay permisos inválidos', async () => {
    Rol.findOne.mockResolvedValue({ _id: 'r1', clubId: 'CARC', save: vi.fn() });
    const req = { params: { id: 'r1' }, body: { permisos: ['no:existe'] } };
    const res = mockRes();
    await updateSuperRolHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 400 (no revienta el proceso) si permisos no es un array', async () => {
    const req = { params: { id: 'r1' }, body: { permisos: 'admin' } };
    const res = mockRes();
    await expect(updateSuperRolHandler(req, res)).resolves.not.toThrow();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Rol.findOne).not.toHaveBeenCalled();
  });
});

describe('deleteSuperRolHandler', () => {
  it('devuelve 404 si el rol no existe', async () => {
    Rol.findOne.mockResolvedValue(null);
    const req = { params: { id: 'x' } };
    const res = mockRes();
    await deleteSuperRolHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('desactiva el rol e invalida el cache del club del rol', async () => {
    const rol = { _id: 'r1', clubId: 'CARC', slug: 'entrenador', active: true, save: vi.fn() };
    Rol.findOne.mockResolvedValue(rol);
    User.exists.mockResolvedValue(null);

    const req = { params: { id: 'r1' } };
    const res = mockRes();
    await deleteSuperRolHandler(req, res);

    expect(rol.active).toBe(false);
    expect(invalidarClub).toHaveBeenCalledWith('CARC');
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('appcarc-superadmin#37: devuelve 409 si el rol todavía tiene usuarios asignados', async () => {
    const rol = { _id: 'r1', clubId: 'CARC', slug: 'entrenador', active: true, save: vi.fn() };
    Rol.findOne.mockResolvedValue(rol);
    User.exists.mockResolvedValue(true);

    const req = { params: { id: 'r1' } };
    const res = mockRes();
    await deleteSuperRolHandler(req, res);

    expect(rol.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it.each(['socio', 'admin'])('devuelve 409 si el rol es un slug protegido (%s)', async (slug) => {
    const rol = { _id: 'r1', clubId: 'CARC', slug, active: true, save: vi.fn() };
    Rol.findOne.mockResolvedValue(rol);

    const req = { params: { id: 'r1' } };
    const res = mockRes();
    await deleteSuperRolHandler(req, res);

    expect(rol.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('getPermisosCatalogoHandler', () => {
  it('devuelve el catálogo agrupado (200)', async () => {
    const req = {};
    const res = mockRes();
    await getPermisosCatalogoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(PERMISOS_POR_CATEGORIA);
  });
});

describe('PERMISOS_POR_CATEGORIA (consistencia)', () => {
  it('cubre exactamente TODOS_LOS_PERMISOS, sin faltantes ni duplicados', () => {
    const aplanado = PERMISOS_POR_CATEGORIA.flatMap((c) => c.permisos);
    expect(new Set(aplanado).size).toBe(aplanado.length);
    expect([...aplanado].sort()).toEqual([...TODOS_LOS_PERMISOS].sort());
  });
});
