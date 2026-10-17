import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('bcryptjs', () => ({
  default: {
    genSalt: vi.fn().mockResolvedValue('salt'),
    hash: vi.fn().mockResolvedValue('hashed-password'),
  },
}));
const mockSave = vi.fn().mockResolvedValue(undefined);
vi.mock('../../models/User.js', () => ({
  default: Object.assign(
    vi.fn().mockImplementation((data) => ({ ...data, save: mockSave })),
    { findOne: vi.fn() },
  ),
}));
vi.mock('../../../roles/services/resolverRoles.service.js', () => ({
  obtenerRolIdsPorSlugs: vi.fn().mockResolvedValue(['rol-socio-id']),
  obtenerSlugsPorRolIds: vi.fn().mockResolvedValue(['socio']),
}));

import User from '../../models/User.js';
import { obtenerRolIdsPorSlugs, obtenerSlugsPorRolIds } from '../../../roles/services/resolverRoles.service.js';
import { syncSocioUserFromSocio } from '../../services/userSync.js';

const HIJO_ID = '507f1f77bcf86cd799439011';
const PADRE_ID = '507f1f77bcf86cd799439012';

const buildSocio = (overrides = {}) => ({
  _id: HIJO_ID,
  clubId: 'CARC',
  nombre: 'Hijo',
  apellido: 'García',
  correoElectronico: 'papa@carc.test',
  dni: '30111222',
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  obtenerSlugsPorRolIds.mockResolvedValue([]); // sin rol protegido por default; los tests que lo necesiten lo pisan
});

describe('syncSocioUserFromSocio', () => {
  it('devuelve null si al socio le falta email o dni', async () => {
    expect(await syncSocioUserFromSocio(buildSocio({ correoElectronico: '' }))).toBeNull();
    expect(await syncSocioUserFromSocio(buildSocio({ dni: '' }))).toBeNull();
    expect(User.findOne).not.toHaveBeenCalled();
  });

  it('crea un User nuevo si no existe ni por socioId ni por email', async () => {
    User.findOne.mockResolvedValue(null);

    const user = await syncSocioUserFromSocio(buildSocio());

    expect(user.email).toBe('papa@carc.test');
    expect(user.socioId).toBe(HIJO_ID);
    expect(mockSave).toHaveBeenCalled();
  });

  it('actualiza el User existente cuando el socioId coincide (mismo socio)', async () => {
    const existing = { socioId: HIJO_ID, roles: ['rol-viejo'], nombre: 'Viejo', save: vi.fn().mockResolvedValue(undefined) };
    User.findOne.mockResolvedValueOnce(existing);

    const user = await syncSocioUserFromSocio(buildSocio());

    expect(user.nombre).toBe('García Hijo');
    expect(user.roles).toEqual(['rol-socio-id']);
    expect(existing.save).toHaveBeenCalled();
  });

  it('no pisa roles/password si el User ya tiene un rol protegido (admin/secretaria/socio)', async () => {
    obtenerSlugsPorRolIds.mockResolvedValue(['secretaria']);
    const existing = { socioId: HIJO_ID, roles: ['rol-secretaria'], nombre: 'Viejo', password: 'hash-original', save: vi.fn().mockResolvedValue(undefined) };
    User.findOne.mockResolvedValueOnce(existing);

    await syncSocioUserFromSocio(buildSocio());

    expect(existing.roles).toEqual(['rol-secretaria']);
    expect(existing.password).toBe('hash-original');
  });

  it('#198: no degrada el rol ni resetea la password de un staff no protegido (ej. profesor que también es socio)', async () => {
    obtenerSlugsPorRolIds.mockResolvedValue(['profesor']);
    const existing = { socioId: HIJO_ID, roles: ['rol-profesor'], nombre: 'Viejo', password: 'hash-original', active: false, save: vi.fn().mockResolvedValue(undefined) };
    User.findOne.mockResolvedValueOnce(existing);

    await syncSocioUserFromSocio(buildSocio());

    expect(existing.roles).toEqual(['rol-profesor']);
    expect(existing.password).toBe('hash-original');
    expect(existing.active).toBe(false);
    expect(existing.save).toHaveBeenCalled();
  });

  it('BUG #54: no fusiona identidades cuando el email ya pertenece al User de OTRO socio (ej. padre)', async () => {
    const userDelPadre = {
      socioId: PADRE_ID,
      roles: ['rol-profesor'],
      nombre: 'Papá García',
      password: 'hash-del-padre',
      active: true,
      save: vi.fn().mockResolvedValue(undefined),
    };
    // No matchea por socioId (es el del hijo), sí matchea por email (el del padre)
    User.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(userDelPadre);

    const result = await syncSocioUserFromSocio(buildSocio());

    expect(result).toBeNull();
    expect(userDelPadre.nombre).toBe('Papá García');
    expect(userDelPadre.roles).toEqual(['rol-profesor']);
    expect(userDelPadre.password).toBe('hash-del-padre');
    expect(userDelPadre.save).not.toHaveBeenCalled();
  });

  it('appcarc-backend#66: el fallback por email filtra por clubId (no se roba un User de otro club)', async () => {
    User.findOne.mockResolvedValue(null);

    await syncSocioUserFromSocio(buildSocio({ clubId: 'OTROCLUB' }));

    expect(User.findOne).toHaveBeenNthCalledWith(2, { email: 'papa@carc.test', clubId: 'OTROCLUB' });
  });

  it('sí reutiliza un User encontrado por email si todavía no tiene socioId propio (ej. cuenta de tutor)', async () => {
    const userTutor = { socioId: undefined, roles: ['rol-socio-id'], nombre: 'Tutor', save: vi.fn().mockResolvedValue(undefined) };
    User.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(userTutor);

    const user = await syncSocioUserFromSocio(buildSocio());

    expect(user).toBe(userTutor);
    expect(user.socioId).toBe(HIJO_ID);
    expect(userTutor.save).toHaveBeenCalled();
  });
});
