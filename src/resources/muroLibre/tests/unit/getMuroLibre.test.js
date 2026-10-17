import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../asistencias/models/Asistencia.js', () => ({
  default: {
    countDocuments: vi.fn(),
    find: vi.fn(),
  },
}));

vi.mock('../../../../services/permisosCache.js', () => ({
  tienePermiso: vi.fn(),
}));

import { getMuroLibreHandler } from '../../handlers/getMuroLibre.handler.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import { tienePermiso } from '../../../../services/permisosCache.js';

const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockFind = (results = []) =>
  Asistencia.find.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      skip: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(results),
      }),
    }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  tienePermiso.mockResolvedValue(false);
});

describe('getMuroLibreHandler', () => {
  it('devuelve lista paginada de asistencias', async () => {
    const registros = [{ tipo: 'muro_libre', fecha: new Date() }];
    Asistencia.countDocuments.mockResolvedValue(1);
    mockFind(registros);

    const req = { user: mockUser, query: {} };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ total: 1, registros }));
  });

  it('aplica filtro de fecha from/to', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);

    const req = { user: mockUser, query: { from: '2026-01-01', to: '2026-01-31' } };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(Asistencia.countDocuments).toHaveBeenCalledWith(
      expect.objectContaining({ fecha: expect.objectContaining({ $gte: expect.any(Date), $lte: expect.any(Date) }) }),
    );
  });

  it('respeta límite máximo de 500', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);

    const req = { user: mockUser, query: { limit: '9999' } };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 500 }));
  });

  it('retorna 500 si hay error', async () => {
    Asistencia.countDocuments.mockRejectedValue(new Error('DB'));

    const req = { user: mockUser, query: {} };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('un socio puro (sin muroLibre:write) ve solo lo propio', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(false);

    const req = { user: { clubId: 'CARC', roles: ['socio'], socioId: 'socio1' }, query: {} };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(Asistencia.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socio1' }));
  });

  it('un profesor que también es socio (rol doble real) NO ve todo el club, solo lo propio', async () => {
    // Caso real detectado en producción: roles.every(r => r === 'socio') daba
    // false para este usuario y el auto-scope no se aplicaba.
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(false); // profesor no tiene muroLibre:write

    const req = { user: { clubId: 'CARC', roles: ['profesor', 'socio'], socioId: 'socio1' }, query: {} };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(Asistencia.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socio1' }));
  });

  it('un rol con muroLibre:write (palestrero/secretaria/admin) ve todo el club', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(true);

    const req = { user: { clubId: 'CARC', roles: ['palestrero'], socioId: 'socio1' }, query: {} };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    const callArg = Asistencia.countDocuments.mock.calls[0][0];
    expect(callArg.socioId).toBeUndefined();
  });

  it('autoridad ve todo el club aunque no tenga muroLibre:write', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(false);

    const req = { user: { clubId: 'CARC', roles: ['autoridad'], socioId: null }, query: {} };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    const callArg = Asistencia.countDocuments.mock.calls[0][0];
    expect(callArg.socioId).toBeUndefined();
  });

  it('un admin que también es socio y pide ?socioId=<el propio> ve solo lo propio, no todo el club', async () => {
    // Bug real: "Mis Visitas" (mobile) siempre manda ?socioId=<el propio>,
    // pero antes de este fix el filtro se ignoraba por completo para
    // cualquier cuenta con muroLibre:write — un admin/secretaria/palestrero
    // que también es socio del club veía el historial de TODO el club en su
    // propia pantalla de "mis visitas" en vez de las suyas.
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(true); // admin tiene muroLibre:write

    const req = { user: { clubId: 'CARC', roles: ['admin', 'socio'], socioId: 'socioAdmin1' }, query: { socioId: 'socioAdmin1' } };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(Asistencia.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socioAdmin1' }));
  });

  it('staff puede acotar a un socio puntual distinto al propio vía ?socioId=', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(true);

    const req = { user: { clubId: 'CARC', roles: ['secretaria'], socioId: 'socioSecre1' }, query: { socioId: 'otroSocio' } };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(Asistencia.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'otroSocio' }));
  });

  it('un socio puro no puede ver el historial de otro aunque mande ?socioId= de otra persona', async () => {
    Asistencia.countDocuments.mockResolvedValue(0);
    mockFind([]);
    tienePermiso.mockResolvedValue(false);

    const req = { user: { clubId: 'CARC', roles: ['socio'], socioId: 'socio1' }, query: { socioId: 'otroSocio' } };
    const res = mockRes();
    await getMuroLibreHandler(req, res);

    expect(Asistencia.countDocuments).toHaveBeenCalledWith(expect.objectContaining({ socioId: 'socio1' }));
  });
});
