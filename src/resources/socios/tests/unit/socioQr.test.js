import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';
import Socio from '../../models/Socio.js';
import {
  generateSocioQrToken,
  decodeSocioQrToken,
  resolveSocioFromQrToken,
  findActiveSocioByDni,
  resolveSocioFromQrTokenOrDni,
  getSocioDebtSummary,
  getPaseMuroLibreVigente,
} from '../../services/socioQr.service.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';

const mockSocio = { _id: '507f1f77bcf86cd799439011', clubId: 'club1', active: true, nombre: 'Juan', apellido: 'Perez', dni: '123' };

describe('Socio QR service', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';

    vi.spyOn(jwt, 'sign').mockImplementation((payload) => `signed-${payload.socioId}`);
    vi.spyOn(jwt, 'verify').mockImplementation((token) => {
      const socioId = String(token || '').replace(/^signed-/, '');
      if (!socioId) throw new Error('invalid token');
      return { clubId: 'club1', socioId, type: 'socio_qr' };
    });

    Socio.findOne = vi.fn();
    Cuota.aggregate = vi.fn();
    Cuota.findOne = vi.fn();
    Etiqueta.findOne = vi.fn();
    Suscripcion.findOne = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should generate a signed QR token for socio', () => {
    const token = generateSocioQrToken({ clubId: 'club1', socioId: 'socio1' });
    expect(token).toBe('signed-socio1');
    expect(jwt.sign).toHaveBeenCalledWith({ clubId: 'club1', socioId: 'socio1', type: 'socio_qr' }, process.env.JWT_SECRET, { algorithm: 'HS256', expiresIn: '30d' });
  });

  it('should decode a valid QR token', () => {
    const payload = decodeSocioQrToken('signed-socio1');
    expect(payload).toEqual({ clubId: 'club1', socioId: 'socio1', type: 'socio_qr' });
  });

  it('should resolve socio from QR token when club matches', async () => {
    Socio.findOne.mockResolvedValue(mockSocio);
    const socio = await resolveSocioFromQrToken('signed-507f1f77bcf86cd799439011', 'club1');
    expect(socio).toEqual(mockSocio);
  });

  it('should reject resolveSocioFromQrToken if club does not match', async () => {
    await expect(resolveSocioFromQrToken('signed-507f1f77bcf86cd799439011', 'club2')).rejects.toThrow('El QR no pertenece a este club');
  });

  it('should find socio by DNI', async () => {
    Socio.findOne.mockResolvedValue(mockSocio);
    const socio = await findActiveSocioByDni('123', 'club1');
    expect(Socio.findOne).toHaveBeenCalledWith({ dni: '123', clubId: 'club1', active: true });
    expect(socio).toEqual(mockSocio);
  });

  it('should resolve socio from token or DNI with method metadata', async () => {
    Socio.findOne.mockResolvedValue(mockSocio);

    const byToken = await resolveSocioFromQrTokenOrDni({ token: 'signed-507f1f77bcf86cd799439011', clubId: 'club1' });
    const byDni = await resolveSocioFromQrTokenOrDni({ dni: '123', clubId: 'club1' });

    expect(byToken).toEqual({ socio: mockSocio, method: 'QR' });
    expect(byDni).toEqual({ socio: mockSocio, method: 'DNI' });
  });

  it('should reject resolving without token or DNI', async () => {
    await expect(resolveSocioFromQrTokenOrDni({ clubId: 'club1' })).rejects.toThrow('Se requiere token QR o DNI');
  });

  it('should return debt summary with pending quotas', async () => {
    Cuota.aggregate.mockResolvedValue([{ count: 2, totalAmount: 5000 }]);
    const summary = await getSocioDebtSummary('507f1f77bcf86cd799439011', 'club1');
    expect(summary).toEqual({ pendingCount: 2, pendingAmount: 5000 });
  });

  describe('getPaseMuroLibreVigente', () => {
    it('should not report vencido when the etiqueta mensual does not exist', async () => {
      Etiqueta.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

      const result = await getPaseMuroLibreVigente('507f1f77bcf86cd799439011', 'club1');

      expect(result.suscripto).toBe(false);
      expect(result.vigente).toBeNull();
      expect(Suscripcion.findOne).not.toHaveBeenCalled();
    });

    it('un pase mensual programado para un mes futuro no cuenta como pase activo (filtra fechaDesde <= período actual)', async () => {
      Etiqueta.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'etq1' }) });
      Suscripcion.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

      const result = await getPaseMuroLibreVigente('507f1f77bcf86cd799439011', 'club1');

      expect(Suscripcion.findOne).toHaveBeenCalledWith(expect.objectContaining({
        active: true,
        fechaDesde: { $lte: result.periodo },
      }));
    });

    it('should not report vencido when socio has no active suscripcion', async () => {
      Etiqueta.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'etq1' }) });
      Suscripcion.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

      const result = await getPaseMuroLibreVigente('507f1f77bcf86cd799439011', 'club1');

      expect(result).toEqual({ suscripto: false, vigente: null, periodo: expect.any(String) });
      expect(Cuota.findOne).not.toHaveBeenCalled();
    });

    it('should report vencido when suscripto but sin cuota pagada del período', async () => {
      Etiqueta.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'etq1' }) });
      Suscripcion.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'susc1' }) });
      Cuota.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

      const result = await getPaseMuroLibreVigente('507f1f77bcf86cd799439011', 'club1');

      expect(result.suscripto).toBe(true);
      expect(result.vigente).toBe(false);
    });

    it('should report vigente when suscripto y cuota pagada del período', async () => {
      Etiqueta.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'etq1' }) });
      Suscripcion.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'susc1' }) });
      Cuota.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'cuota1' }) });

      const result = await getPaseMuroLibreVigente('507f1f77bcf86cd799439011', 'club1');

      expect(result.suscripto).toBe(true);
      expect(result.vigente).toBe(true);
    });
  });
});
