vi.mock('../../services/pasesClases.service.js', () => ({
  pasesIncluidosSemana: vi.fn().mockResolvedValue({ max: 0, usados: 0, restantes: 0, proximaRenovacion: null }),
}));
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { checkinMuroLibreHandler } from '../../handlers/checkinMuroLibre.handler.js';
import * as socioQrService from '../../../socios/services/socioQr.service.js';
import * as muroLibreService from '../../services/registrarMuroLibre.service.js';
import * as permisosCache from '../../../../services/permisosCache.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('checkinMuroLibreHandler', () => {
  beforeEach(() => {
    vi.spyOn(muroLibreService, 'registrarMuroLibre').mockResolvedValue({ registro: { _id: 'ml1' }, movimiento: null });
    vi.spyOn(socioQrService, 'resolveSocioFromQrTokenOrDni').mockResolvedValue({ socio: { _id: 'socio1' }, method: 'QR' });
    vi.spyOn(permisosCache, 'tienePermiso').mockResolvedValue(true); // staff por defecto en estos tests
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should checkin via QR token and return 201', async () => {
    const req = {
      body: { token: 'qr-token', tipoPase: 'diario', estadoPago: 'pendiente' },
      user: { clubId: 'club1', id: 'staff1', roles: ['secretaria'] },
    };
    const res = mockRes();

    await checkinMuroLibreHandler(req, res);

    expect(socioQrService.resolveSocioFromQrTokenOrDni).toHaveBeenCalledWith({
      token: 'qr-token',
      dni: undefined,
      clubId: 'club1',
      missingMessage: 'Se requiere token QR o DNI para identificar el socio',
    });
    expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'club1',
      user: req.user,
      body: expect.objectContaining({ socioId: 'socio1', tipoPase: 'diario' }),
      scannedBy: 'staff1',
      checkinMethod: 'QR',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should checkin via DNI when no token is provided', async () => {
    const req = {
      body: { dni: '123', tipoPase: 'mensual', estadoPago: 'pendiente' },
      user: { clubId: 'club1', id: 'staff1' },
    };
    const res = mockRes();

    socioQrService.resolveSocioFromQrTokenOrDni.mockResolvedValueOnce({ socio: { _id: 'socio1' }, method: 'DNI' });
    await checkinMuroLibreHandler(req, res);

    expect(socioQrService.resolveSocioFromQrTokenOrDni).toHaveBeenCalledWith({
      token: undefined,
      dni: '123',
      clubId: 'club1',
      missingMessage: 'Se requiere token QR o DNI para identificar el socio',
    });
    expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
      checkinMethod: 'DNI',
    }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('should forward fecha from the body to registrarMuroLibre', async () => {
    const req = {
      body: { dni: '123', tipoPase: 'diario', estadoPago: 'pendiente', fecha: '2026-07-20T15:00:00.000Z' },
      user: { clubId: 'club1', id: 'staff1' },
    };
    const res = mockRes();

    await checkinMuroLibreHandler(req, res);

    expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.objectContaining({ fecha: '2026-07-20T15:00:00.000Z' }),
    }));
  });

  it('should return 400 when resolveSocioFromQrTokenOrDni rejects an explicit token', async () => {
    const req = { body: { token: 'qr-invalido', tipoPase: 'diario' }, user: { clubId: 'club1', id: 'staff1', roles: ['secretaria'] } };
    const res = mockRes();

    socioQrService.resolveSocioFromQrTokenOrDni.mockRejectedValueOnce(
      Object.assign(new Error('Se requiere token QR o DNI para identificar el socio'), { status: 400 })
    );
    await checkinMuroLibreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: 'Se requiere token QR o DNI para identificar el socio' });
  });

  describe('autoescaneo (checkin_propio, sin permiso de staff)', () => {
    beforeEach(() => {
      permisosCache.tienePermiso.mockResolvedValue(false);
      vi.spyOn(socioQrService, 'findActiveSocioById').mockResolvedValue({ _id: 'socio1' });
    });

    it('usa el socio del usuario logueado cuando el body no trae token/dni', async () => {
      vi.spyOn(socioQrService, 'getPaseMuroLibreVigente').mockResolvedValue({ suscripto: false, vigente: null });
      const req = {
        body: { tipoPase: 'mensual', estadoPago: 'pagado' },
        user: { clubId: 'club1', id: 'user1', socioId: 'socio1', roles: ['socio'] },
      };
      const res = mockRes();

      await checkinMuroLibreHandler(req, res);

      expect(socioQrService.resolveSocioFromQrTokenOrDni).not.toHaveBeenCalled();
      expect(socioQrService.findActiveSocioById).toHaveBeenCalledWith('socio1', 'club1');
      expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({ socioId: 'socio1', tipoPase: 'diario', estadoPago: 'pendiente', paymentMethod: undefined }),
        checkinMethod: 'SELF',
      }));
      expect(res.status).toHaveBeenCalledWith(201);
    });

    it('rechaza con 403 si el body trae token/dni pero el usuario no tiene permiso de staff (no ignora silenciosamente)', async () => {
      const req = {
        body: { token: 'algo-que-no-deberia-usarse', dni: '999', tipoPase: 'mensual', estadoPago: 'pagado' },
        user: { clubId: 'club1', id: 'user1', socioId: 'socio1', roles: ['socio'] },
      };
      const res = mockRes();

      await checkinMuroLibreHandler(req, res);

      expect(socioQrService.findActiveSocioById).not.toHaveBeenCalled();
      expect(muroLibreService.registrarMuroLibre).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it('usa tipoPase mensual cuando el socio ya está suscripto al pase mensual', async () => {
      vi.spyOn(socioQrService, 'getPaseMuroLibreVigente').mockResolvedValue({ suscripto: true, vigente: true });
      const req = {
        body: {},
        user: { clubId: 'club1', id: 'user1', socioId: 'socio1', roles: ['socio'] },
      };
      const res = mockRes();

      await checkinMuroLibreHandler(req, res);

      expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({ tipoPase: 'mensual', estadoPago: 'pendiente' }),
      }));
    });

    it('appcarc-backend#154: ignora la fecha del body en autoescaneo (no deja fabricar historial con fechas arbitrarias)', async () => {
      vi.spyOn(socioQrService, 'getPaseMuroLibreVigente').mockResolvedValue({ suscripto: false, vigente: null });
      const req = {
        body: { tipoPase: 'diario', estadoPago: 'pendiente', fecha: '2020-01-01T12:00:00.000Z' },
        user: { clubId: 'club1', id: 'user1', socioId: 'socio1', roles: ['socio'] },
      };
      const res = mockRes();

      await checkinMuroLibreHandler(req, res);

      expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({ fecha: undefined }),
      }));
    });

    it('devuelve 403 si el usuario no tiene socio asociado', async () => {
      const req = { body: {}, user: { clubId: 'club1', id: 'user1', roles: ['algunRolSinSocio'] } };
      const res = mockRes();

      await checkinMuroLibreHandler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(muroLibreService.registrarMuroLibre).not.toHaveBeenCalled();
    });
  });

  describe('autoescaneo (checkin_propio, usuario CON permiso de staff — bug appCARC-mobile#60)', () => {
    it('un staff que escanea el cartel para sí mismo (body vacío) hace self-checkin en vez de que se le exija token/dni', async () => {
      permisosCache.tienePermiso.mockResolvedValue(true); // staff
      vi.spyOn(socioQrService, 'findActiveSocioById').mockResolvedValue({ _id: 'socio1' });
      vi.spyOn(socioQrService, 'getPaseMuroLibreVigente').mockResolvedValue({ suscripto: false, vigente: null });
      const req = {
        body: {},
        user: { clubId: 'club1', id: 'staff1', socioId: 'socio1', roles: ['secretaria'] },
      };
      const res = mockRes();

      await checkinMuroLibreHandler(req, res);

      expect(socioQrService.resolveSocioFromQrTokenOrDni).not.toHaveBeenCalled();
      expect(socioQrService.findActiveSocioById).toHaveBeenCalledWith('socio1', 'club1');
      expect(muroLibreService.registrarMuroLibre).toHaveBeenCalledWith(expect.objectContaining({
        body: expect.objectContaining({ socioId: 'socio1' }),
        checkinMethod: 'SELF',
      }));
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });
});
