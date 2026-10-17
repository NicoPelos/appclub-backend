import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/permisosCache.js', () => ({
  tienePermiso: vi.fn(),
}));

vi.mock('jsonwebtoken', () => ({
  default: { verify: vi.fn() },
}));

vi.mock('../services/tokenBlacklistService.js', () => ({
  default: { hasToken: vi.fn().mockResolvedValue(false) },
}));

vi.mock('../resources/usuarios/models/User.js', () => ({
  default: { findById: vi.fn() },
}));

vi.mock('../resources/vinculos/models/VinculoFamiliar.js', () => ({
  default: { exists: vi.fn() },
}));

vi.mock('../resources/vinculos/services/getSocioIdsAccesibles.service.js', () => ({
  getSocioIdsAccesibles: vi.fn(),
}));

vi.mock('../services/clubActivoCache.js', () => ({
  esClubActivo: vi.fn().mockResolvedValue(true),
}));

import jwt from 'jsonwebtoken';
import { authorizeSelfSocioOr, authorizeSelfSocioQueryOr, authorizeSelfYVinculadosOr, protect } from './auth.js';
import { tienePermiso } from '../services/permisosCache.js';
import tokenService from '../services/tokenBlacklistService.js';
import User from '../resources/usuarios/models/User.js';
import VinculoFamiliar from '../resources/vinculos/models/VinculoFamiliar.js';
import { getSocioIdsAccesibles } from '../resources/vinculos/services/getSocioIdsAccesibles.service.js';
import { esClubActivo } from '../services/clubActivoCache.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('authorizeSelfSocioOr', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deja pasar a un socio operando sobre su propio registro, sin chequear permisos', async () => {
    const req = { user: { roles: ['socio'], socioId: 'socio1', clubId: 'CARC' }, params: { id: 'socio1' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioOr('socios:write')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(tienePermiso).not.toHaveBeenCalled();
  });

  it('rechaza a un socio operando sobre el registro de otro, sin el permiso', async () => {
    tienePermiso.mockResolvedValue(false);
    const req = { user: { roles: ['socio'], socioId: 'socio1', clubId: 'CARC' }, params: { id: 'otroSocio' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioOr('socios:write')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deja pasar a staff con el permiso, aunque no sea el propio socio', async () => {
    tienePermiso.mockResolvedValue(true);
    const req = { user: { roles: ['admin'], socioId: null, clubId: 'CARC' }, params: { id: 'socio1' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioOr('socios:write')(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('deja pasar siempre a superadmin', async () => {
    const req = { user: { roles: ['superadmin'], socioId: null, clubId: 'SUPER' }, params: { id: 'socio1' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioOr('socios:write')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(tienePermiso).not.toHaveBeenCalled();
  });
});

describe('authorizeSelfSocioQueryOr', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deja pasar a un socio consultando su propio socioId por query, sin chequear permisos', async () => {
    const req = { user: { roles: ['socio'], socioId: 'socio1', clubId: 'CARC' }, query: { socioId: 'socio1' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioQueryOr('escuelita:read')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(tienePermiso).not.toHaveBeenCalled();
  });

  it('rechaza a un socio consultando el socioId de otro, sin el permiso', async () => {
    tienePermiso.mockResolvedValue(false);
    const req = { user: { roles: ['socio'], socioId: 'socio1', clubId: 'CARC' }, query: { socioId: 'otroSocio' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioQueryOr('escuelita:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('rechaza a un socio sin query.socioId (listado completo), sin el permiso', async () => {
    tienePermiso.mockResolvedValue(false);
    const req = { user: { roles: ['socio'], socioId: 'socio1', clubId: 'CARC' }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioQueryOr('escuelita:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deja pasar a staff con el permiso, sin importar el query', async () => {
    tienePermiso.mockResolvedValue(true);
    const req = { user: { roles: ['admin'], socioId: null, clubId: 'CARC' }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfSocioQueryOr('escuelita:read')(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('authorizeSelfYVinculadosOr', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sin query.socioId y con perfiles accesibles, deja pasar y guarda req.accessibleSocioIds', async () => {
    getSocioIdsAccesibles.mockResolvedValue({ ownSocioId: 'socio1', accessibleIds: new Set(['socio1', 'hijo1']) });
    const req = { user: { id: 'u1', roles: ['socio'], clubId: 'CARC' }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfYVinculadosOr('cobros:read')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(tienePermiso).not.toHaveBeenCalled();
    expect(req.accessibleSocioIds).toEqual(new Set(['socio1', 'hijo1']));
  });

  it('sin query.socioId pero sin ningún perfil accesible, cae al chequeo de permiso normal', async () => {
    getSocioIdsAccesibles.mockResolvedValue({ ownSocioId: null, accessibleIds: new Set() });
    tienePermiso.mockResolvedValue(false);
    const req = { user: { id: 'u1', roles: ['staffSinPermiso'], clubId: 'CARC' }, query: {} };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfYVinculadosOr('cobros:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('con query.socioId puntual (consulta de staff), no usa el atajo y exige el permiso', async () => {
    tienePermiso.mockResolvedValue(true);
    const req = { user: { id: 'u1', roles: ['secretaria'], clubId: 'CARC' }, query: { socioId: 'otroSocio' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfYVinculadosOr('cobros:read')(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(getSocioIdsAccesibles).not.toHaveBeenCalled();
    expect(tienePermiso).toHaveBeenCalled();
  });

  it('rechaza con 403 si trae query.socioId y no tiene el permiso de staff', async () => {
    tienePermiso.mockResolvedValue(false);
    const req = { user: { id: 'u1', roles: ['socio'], clubId: 'CARC' }, query: { socioId: 'otroSocio' } };
    const res = mockRes();
    const next = vi.fn();

    await authorizeSelfYVinculadosOr('cobros:read')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe('protect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tokenService.hasToken.mockResolvedValue(false);
  });

  const mockReq = () => ({ headers: { authorization: 'Bearer tok123' } });

  it('deja pasar cuando el socioId del token es el propio del User, sin consultar VinculoFamiliar', async () => {
    jwt.verify.mockReturnValue({ id: 'u1', clubId: 'CARC', socioId: 'socio1', iat: 1000 });
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ active: true, socioId: 'socio1' }) }) });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(VinculoFamiliar.exists).not.toHaveBeenCalled();
  });

  it('deja pasar cuando el token no trae socioId (staff), sin consultar VinculoFamiliar', async () => {
    jwt.verify.mockReturnValue({ id: 'u1', clubId: 'CARC', socioId: null, iat: 1000 });
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ active: true, socioId: null }) }) });
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(VinculoFamiliar.exists).not.toHaveBeenCalled();
  });

  it('deja pasar cuando actúa vía un perfil vinculado y el vínculo sigue activo', async () => {
    jwt.verify.mockReturnValue({ id: 'padre1', clubId: 'CARC', socioId: 'hijo1', iat: 1000 });
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ active: true, socioId: 'socioPropioPadre' }) }) });
    VinculoFamiliar.exists.mockResolvedValue(true);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(VinculoFamiliar.exists).toHaveBeenCalledWith({
      clubId: 'CARC', padreUserId: 'padre1', hijoSocioId: 'hijo1', active: true,
    });
    expect(next).toHaveBeenCalled();
  });

  it('rechaza con 401 si el vínculo fue anulado (appcarc-backend#71)', async () => {
    jwt.verify.mockReturnValue({ id: 'padre1', clubId: 'CARC', socioId: 'hijo1', iat: 1000 });
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ active: true, socioId: 'socioPropioPadre' }) }) });
    VinculoFamiliar.exists.mockResolvedValue(null);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rechaza con 403 si el club del token está suspendido (appcarc-backend#169)', async () => {
    jwt.verify.mockReturnValue({ id: 'u1', clubId: 'CARC', roles: ['secretaria'], socioId: null, iat: 1000 });
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ active: true, socioId: null }) }) });
    esClubActivo.mockResolvedValue(false);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(esClubActivo).toHaveBeenCalledWith('CARC');
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('deja pasar a superadmin aunque esClubActivo resuelva false para su clubId', async () => {
    jwt.verify.mockReturnValue({ id: 'super1', clubId: 'SUPER', roles: ['superadmin'], socioId: null, iat: 1000 });
    User.findById.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ active: true, socioId: null }) }) });
    esClubActivo.mockResolvedValue(false);
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    await protect(req, res, next);

    expect(esClubActivo).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });
});
