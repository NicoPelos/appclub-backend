import { describe, it, expect, vi, beforeEach } from 'vitest';
import { syncSheetsHandler } from '../../handlers/syncSheets.handler.js';

vi.mock('../../../clubs/models/Club.js', () => ({
  default: { findOne: vi.fn() },
}));

vi.mock('../../../../services/sheetsExport.service.js', () => ({
  exportToSheets: vi.fn(),
}));

import Club from '../../../clubs/models/Club.js';
import { exportToSheets } from '../../../../services/sheetsExport.service.js';

const mockUser = { clubId: 'CARC', email: 'admin@carc.com' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const buildClub = (overrides = {}) => ({
  slug: 'CARC',
  nombre: 'Club Andino Río Cuarto',
  modulos: { exportSheets: true },
  integraciones: { sheets: { spreadsheetId: 'sheet-viejo' } },
  save: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('syncSheetsHandler', () => {
  it('retorna 403 si el club no tiene modulos.exportSheets habilitado', async () => {
    Club.findOne.mockResolvedValue(buildClub({ modulos: { exportSheets: false } }));
    const req = { user: mockUser };
    const res = mockRes();

    await syncSheetsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('no está habilitada') }));
    expect(exportToSheets).not.toHaveBeenCalled();
  });

  it('retorna 403 si el club no existe', async () => {
    Club.findOne.mockResolvedValue(null);
    const req = { user: mockUser };
    const res = mockRes();

    await syncSheetsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(exportToSheets).not.toHaveBeenCalled();
  });

  it('exporta correctamente cuando modulos.exportSheets está habilitado (200)', async () => {
    const club = buildClub();
    Club.findOne.mockResolvedValue(club);
    exportToSheets.mockResolvedValue({
      url: 'https://docs.google.com/spreadsheets/d/nuevo',
      spreadsheetId: 'sheet-nuevo',
      stats: { socios: 10, cobros: 5, horarios: 2 },
    });
    const req = { user: mockUser };
    const res = mockRes();

    await syncSheetsHandler(req, res);

    expect(exportToSheets).toHaveBeenCalledWith({ clubId: 'CARC', clubName: club.nombre, spreadsheetId: 'sheet-viejo' });
    expect(club.integraciones.sheets.spreadsheetId).toBe('sheet-nuevo');
    expect(club.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('no actualiza el club si el spreadsheetId no cambió', async () => {
    const club = buildClub();
    Club.findOne.mockResolvedValue(club);
    exportToSheets.mockResolvedValue({ url: 'https://x', spreadsheetId: 'sheet-viejo', stats: {} });
    const req = { user: mockUser };
    const res = mockRes();

    await syncSheetsHandler(req, res);

    expect(club.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 500 si exportToSheets falla', async () => {
    Club.findOne.mockResolvedValue(buildClub());
    exportToSheets.mockRejectedValue(new Error('Google API caída'));
    const req = { user: mockUser };
    const res = mockRes();

    await syncSheetsHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
