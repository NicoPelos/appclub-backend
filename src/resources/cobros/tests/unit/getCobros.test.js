import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Cobro.js', () => ({
  default: { countDocuments: vi.fn(), find: vi.fn() },
}));
vi.mock('../../../movimientos/models/Movimiento.js', () => ({
  default: { find: vi.fn() },
}));

import Cobro from '../../models/Cobro.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import { getCobrosHandler } from '../../handlers/getCobros.handler.js';

const CLUB_ID = 'CARC';

const buildRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

// Soporta tanto el camino paginado en la base (sort/skip/limit/populate) como
// el camino "volumen chico" (populate/lean) — ambos resuelven al array que
// se les pase, vía el thenable.
const mockQuery = (model, items) => {
  const query = {
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    populate: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnThis(),
    then: (resolve) => resolve(items),
  };
  model.find.mockReturnValue(query);
  return query;
};

beforeEach(() => {
  vi.clearAllMocks();
  Cobro.countDocuments.mockResolvedValue(0);
  mockQuery(Cobro, []);
  mockQuery(Movimiento, []);
});

describe('getCobrosHandler', () => {
  it('con req.accessibleSocioIds (autoservicio), filtra items.socioId con $in y no usa query.socioId', async () => {
    const req = {
      user: { clubId: CLUB_ID },
      query: {},
      accessibleSocioIds: new Set(['socio1', 'hijo1']),
    };
    const res = buildRes();

    await getCobrosHandler(req, res);

    expect(Cobro.find).toHaveBeenCalledWith(expect.objectContaining({
      'items.socioId': { $in: expect.arrayContaining(['socio1', 'hijo1']) },
    }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('con query.socioId (consulta de staff), filtra por ese socio puntual', async () => {
    const req = { user: { clubId: CLUB_ID }, query: { socioId: 'socio-x' } };
    const res = buildRes();

    await getCobrosHandler(req, res);

    expect(Cobro.find).toHaveBeenCalledWith(expect.objectContaining({ 'items.socioId': 'socio-x' }));
  });

  it('sin accessibleSocioIds ni query.socioId, no agrega filtro de socio (listado general de staff) ni consulta Movimiento', async () => {
    const req = { user: { clubId: CLUB_ID }, query: {} };
    const res = buildRes();

    await getCobrosHandler(req, res);

    const filtroUsado = Cobro.find.mock.calls[0][0];
    expect(filtroUsado).not.toHaveProperty('items.socioId');
    expect(Movimiento.find).not.toHaveBeenCalled();
  });

  it('responde con la forma paginada { page, limit, total, totalPages, cobros }', async () => {
    Cobro.countDocuments.mockResolvedValue(1);
    mockQuery(Cobro, [{ _id: 'c1' }]);
    const req = { user: { clubId: CLUB_ID }, query: {} };
    const res = buildRes();

    await getCobrosHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({
      page: 1, limit: 20, total: 1, totalPages: 1, cobros: [{ _id: 'c1' }],
    });
  });

  // appcarc-backend#266
  describe('pagos de eventos mezclados en el historial (autoservicio / socio puntual)', () => {
    it('incluye los Movimiento de sourceType evento_participante del socio, con forma de Cobro', async () => {
      mockQuery(Cobro, []);
      mockQuery(Movimiento, [{
        _id: 'mov1',
        clubId: CLUB_ID,
        responsable: 'secretaria@carc.test',
        paymentMethod: 'MercadoPago',
        amount: 15000,
        concept: 'Evento: Remeras CARC',
        date: new Date('2026-10-07'),
        active: true,
        createdAt: new Date('2026-10-07'),
        socioId: 'socio1',
        eventoId: { nombre: 'Remeras CARC' },
      }]);
      const req = {
        user: { clubId: CLUB_ID },
        query: {},
        accessibleSocioIds: new Set(['socio1']),
      };
      const res = buildRes();

      await getCobrosHandler(req, res);

      expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({
        clubId: CLUB_ID,
        active: true,
        sourceType: 'evento_participante',
        socioId: { $in: ['socio1'] },
      }));
      const body = res.json.mock.calls[0][0];
      expect(body.cobros).toHaveLength(1);
      expect(body.cobros[0]).toMatchObject({
        tipo: 'evento',
        paymentMethod: 'MercadoPago',
        totalAmount: 15000,
        description: 'Evento: Remeras CARC',
        items: [{ socioId: 'socio1' }],
      });
    });

    it('mezcla cobros y pagos de evento ordenados por fecha, sin importar la fuente', async () => {
      mockQuery(Cobro, [{ _id: 'c1', date: new Date('2026-10-01'), createdAt: new Date('2026-10-01'), items: [] }]);
      mockQuery(Movimiento, [{
        _id: 'mov1', clubId: CLUB_ID, responsable: 'x', paymentMethod: 'MercadoPago', amount: 100,
        concept: 'Evento', date: new Date('2026-10-05'), active: true, createdAt: new Date('2026-10-05'),
        socioId: 'socio1', eventoId: null,
      }]);
      const req = { user: { clubId: CLUB_ID }, query: {}, accessibleSocioIds: new Set(['socio1']) };
      const res = buildRes();

      await getCobrosHandler(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.cobros.map((c) => c._id)).toEqual(['mov1', 'c1']); // el de evento es más nuevo, va primero
      expect(body.total).toBe(2);
    });

    it('pagina en memoria sobre la lista mezclada', async () => {
      const cobros = Array.from({ length: 3 }, (_, i) => ({ _id: `c${i}`, date: new Date(2026, 9, i + 1), createdAt: new Date(2026, 9, i + 1), items: [] }));
      mockQuery(Cobro, cobros);
      mockQuery(Movimiento, []);
      const req = {
        user: { clubId: CLUB_ID },
        query: { page: '1', limit: '2' },
        accessibleSocioIds: new Set(['socio1']),
      };
      const res = buildRes();

      await getCobrosHandler(req, res);

      const body = res.json.mock.calls[0][0];
      expect(body.total).toBe(3);
      expect(body.totalPages).toBe(2);
      expect(body.cobros).toHaveLength(2);
    });
  });
});
