import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../cuotas/services/calcularDeuda.service.js', () => ({
  calcularDeuda: vi.fn(),
}));
vi.mock('../../../vinculos/services/getSocioIdsAccesibles.service.js', () => ({
  getSocioIdsAccesibles: vi.fn(),
}));

vi.mock('../../../../services/permisosCache.js', () => ({
  tienePermiso: vi.fn().mockResolvedValue(false),
}));

import { tienePermiso } from '../../../../services/permisosCache.js';
import { calcularDeuda } from '../../../cuotas/services/calcularDeuda.service.js';
import { getSocioIdsAccesibles } from '../../../vinculos/services/getSocioIdsAccesibles.service.js';
import { getSocioDeudaHandler } from '../../handlers/getSocioDeuda.handler.js';

const CLUB_ID = 'CARC';
const SOCIO_ID = '507f1f77bcf86cd799439011';
const HIJO_ID = '507f1f77bcf86cd799439022';
const OTRO_ID = '507f1f77bcf86cd799439099';

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  calcularDeuda.mockResolvedValue({ suscripciones: [], otrosCargos: [] });
  tienePermiso.mockResolvedValue(false);
});

describe('getSocioDeudaHandler', () => {
  it('deja pasar a un socio consultando su propio id', async () => {
    getSocioIdsAccesibles.mockResolvedValue({ ownSocioId: SOCIO_ID, accessibleIds: new Set([SOCIO_ID]) });
    const req = { params: { id: SOCIO_ID }, user: { id: 'u1', roles: ['socio'], clubId: CLUB_ID, socioId: SOCIO_ID } };
    const res = buildRes();

    await getSocioDeudaHandler(req, res);

    expect(calcularDeuda).toHaveBeenCalledWith({ socioId: SOCIO_ID, clubId: CLUB_ID, incluirPrecioHistorico: false });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deja pasar a un tutor consultando la deuda de un hijo vinculado, aunque no sea el perfil activo', async () => {
    getSocioIdsAccesibles.mockResolvedValue({ ownSocioId: SOCIO_ID, accessibleIds: new Set([SOCIO_ID, HIJO_ID]) });
    const req = { params: { id: HIJO_ID }, user: { id: 'u1', roles: ['socio'], clubId: CLUB_ID, socioId: SOCIO_ID } };
    const res = buildRes();

    await getSocioDeudaHandler(req, res);

    expect(calcularDeuda).toHaveBeenCalledWith({ socioId: HIJO_ID, clubId: CLUB_ID, incluirPrecioHistorico: false });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rechaza con 403 a un socio consultando el id de alguien que no es ni suyo ni de un hijo vinculado', async () => {
    getSocioIdsAccesibles.mockResolvedValue({ ownSocioId: SOCIO_ID, accessibleIds: new Set([SOCIO_ID, HIJO_ID]) });
    const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['socio'], clubId: CLUB_ID, socioId: SOCIO_ID } };
    const res = buildRes();

    await getSocioDeudaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(calcularDeuda).not.toHaveBeenCalled();
  });

  it('deja pasar a staff privilegiado sin consultar los vínculos', async () => {
    const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['secretaria'], clubId: CLUB_ID, socioId: null } };
    const res = buildRes();

    await getSocioDeudaHandler(req, res);

    expect(getSocioIdsAccesibles).not.toHaveBeenCalled();
    expect(calcularDeuda).toHaveBeenCalledWith({ socioId: OTRO_ID, clubId: CLUB_ID, incluirPrecioHistorico: false });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('#191: deja pasar a un rol custom del club con socios:read, sin consultar los vínculos', async () => {
    tienePermiso.mockResolvedValue(true);
    const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['tesorera'], clubId: CLUB_ID, socioId: null } };
    const res = buildRes();

    await getSocioDeudaHandler(req, res);

    expect(tienePermiso).toHaveBeenCalledWith(CLUB_ID, ['tesorera'], 'socios:read');
    expect(getSocioIdsAccesibles).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  describe('precio de cada mes (#285): solo con cobros:precio-historico', () => {
    const conPermisos = (...permisos) => tienePermiso.mockImplementation(async (_club, _roles, p) => permisos.includes(p));

    it('staff sin cobros:precio-historico: calcularDeuda sin el desglose', async () => {
      const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['secretaria'], clubId: CLUB_ID, socioId: null } };
      const res = buildRes();

      await getSocioDeudaHandler(req, res);

      expect(tienePermiso).toHaveBeenCalledWith(CLUB_ID, ['secretaria'], 'cobros:precio-historico');
      expect(calcularDeuda).toHaveBeenCalledWith({ socioId: OTRO_ID, clubId: CLUB_ID, incluirPrecioHistorico: false });
    });

    it('con cobros:precio-historico (rol custom): calcularDeuda con el desglose', async () => {
      conPermisos('socios:read', 'cobros:precio-historico');
      const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['tesorera'], clubId: CLUB_ID, socioId: null } };
      const res = buildRes();

      await getSocioDeudaHandler(req, res);

      expect(calcularDeuda).toHaveBeenCalledWith({ socioId: OTRO_ID, clubId: CLUB_ID, incluirPrecioHistorico: true });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('un socio consultando su propia deuda no recibe el desglose', async () => {
      getSocioIdsAccesibles.mockResolvedValue({ ownSocioId: SOCIO_ID, accessibleIds: new Set([SOCIO_ID]) });
      const req = { params: { id: SOCIO_ID }, user: { id: 'u1', roles: ['socio'], clubId: CLUB_ID, socioId: SOCIO_ID } };
      const res = buildRes();

      await getSocioDeudaHandler(req, res);

      expect(calcularDeuda).toHaveBeenCalledWith({ socioId: SOCIO_ID, clubId: CLUB_ID, incluirPrecioHistorico: false });
    });

    it('superadmin lo recibe, igual que pasa authorize()', async () => {
      const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['superadmin'], clubId: CLUB_ID, socioId: null } };
      const res = buildRes();

      await getSocioDeudaHandler(req, res);

      expect(calcularDeuda).toHaveBeenCalledWith({ socioId: OTRO_ID, clubId: CLUB_ID, incluirPrecioHistorico: true });
    });

    it('si falla el chequeo de permisos responde 500 sin calcular', async () => {
      tienePermiso.mockRejectedValue(new Error('Mongo caído'));
      const req = { params: { id: OTRO_ID }, user: { id: 'u1', roles: ['secretaria'], clubId: CLUB_ID, socioId: null } };
      const res = buildRes();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await getSocioDeudaHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(calcularDeuda).not.toHaveBeenCalled();
    });
  });

  it('devuelve 404 si el id no es un ObjectId válido', async () => {
    const req = { params: { id: 'no-es-valido' }, user: { id: 'u1', roles: ['admin'], clubId: CLUB_ID } };
    const res = buildRes();

    await getSocioDeudaHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});
