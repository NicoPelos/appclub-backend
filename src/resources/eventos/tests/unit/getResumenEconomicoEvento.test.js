import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getResumenEconomicoEventoHandler } from '../../handlers/getResumenEconomicoEvento.handler.js';

vi.mock('../../models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../movimientos/models/Movimiento.js', () => ({
  default: { find: vi.fn() },
}));

import Evento from '../../models/Evento.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';

const EVENTO_ID = '507f1f77bcf86cd799439011';
const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const chainableMovimientos = (result) => ({
  select: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getResumenEconomicoEventoHandler', () => {
  it('suma ingresos y egresos tagueados al evento, y calcula el neto', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: EVENTO_ID }) });
    Movimiento.find.mockReturnValue(chainableMovimientos([
      { type: 'Ingreso', amount: 20000, concept: 'Evento: Trekking', categoria: 'Viajes' },
      { type: 'Ingreso', amount: 15000, concept: 'Evento: Trekking', categoria: 'Viajes' },
      { type: 'Egreso', amount: 10000, concept: 'Pago a proveedor', categoria: 'Varios' },
    ]));

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getResumenEconomicoEventoHandler(req, res);

    expect(Movimiento.find).toHaveBeenCalledWith({ eventoId: EVENTO_ID, clubId: 'CARC', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.totalIngresos).toBe(35000);
    expect(body.totalEgresos).toBe(10000);
    expect(body.neto).toBe(25000);
    expect(body.movimientos).toHaveLength(3);
  });

  it('sin movimientos, todo en cero', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: EVENTO_ID }) });
    Movimiento.find.mockReturnValue(chainableMovimientos([]));

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getResumenEconomicoEventoHandler(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body).toMatchObject({ totalIngresos: 0, totalEgresos: 0, neto: 0, movimientos: [] });
  });

  it('retorna 404 si el evento no existe', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getResumenEconomicoEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(Movimiento.find).not.toHaveBeenCalled();
  });

  it('retorna 400 si el id no es válido', async () => {
    const req = { user: mockUser, params: { id: 'invalido' } };
    const res = mockRes();
    await getResumenEconomicoEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('retorna 500 ante un error inesperado', async () => {
    Evento.findOne.mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB down')) });

    const req = { user: mockUser, params: { id: EVENTO_ID } };
    const res = mockRes();
    await getResumenEconomicoEventoHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
