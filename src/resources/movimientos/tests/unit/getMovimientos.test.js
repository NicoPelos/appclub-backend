import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMovimientosHandler, getMovimientoByIdHandler } from '../../handlers/getMovimientos.handler.js';
import Movimiento from '../../models/Movimiento.js';
import Socio from '../../../socios/models/Socio.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };

const makeQuery = (queryable) => ({
  sort: vi.fn().mockReturnThis(),
  skip: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  populate: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(queryable),
});

describe('getMovimientosHandler', () => {
  beforeEach(() => {
    vi.spyOn(Movimiento, 'aggregate').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return active movimientos by default', async () => {
    const movs = [{ _id: 'mov1', type: 'Ingreso', active: true }];
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery(movs));

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.movimientos).toEqual(movs.map((m) => ({ ...m, detalle: null, cobroId: null, participanteId: null })));
    expect(body.total).toBe(1);
  });

  it('appcarc-backend#183: populate de sourceId filtra por clubId del usuario', async () => {
    const query = makeQuery([]);
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(query);

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    expect(query.populate).toHaveBeenCalledWith({ path: 'sourceId', match: { clubId: 'club1' } });
  });

  it('should return deleted movimientos when trash=true', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(2);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { trash: 'true' }, user: USER }, res);

    expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('should filter by type when provided', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { type: 'Egreso' }, user: USER }, res);

    expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({ type: 'Egreso' }));
  });

  it('should ignore invalid type filter', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { type: 'Otro' }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('type');
  });

  it('should filter by paymentMethod when provided', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { paymentMethod: 'Transferencia' }, user: USER }, res);

    expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({ paymentMethod: 'Transferencia' }));
  });

  it('should ignore invalid paymentMethod filter', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { paymentMethod: 'Tarjeta' }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('paymentMethod');
  });

  it('should filter by categoria when provided', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { categoria: 'Costos Fijos' }, user: USER }, res);

    expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({ categoria: 'Costos Fijos' }));
  });

  it('should ignore an invalid categoria filter', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { categoria: 'Inventada' }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('categoria');
  });

  it('should return subtotalesPorMedioPago aggregated over the whole filtered set', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));
    Movimiento.aggregate.mockResolvedValue([
      { _id: { paymentMethod: 'Efectivo', type: 'Ingreso' }, total: 5000 },
      { _id: { paymentMethod: 'Efectivo', type: 'Egreso' }, total: 1200 },
      { _id: { paymentMethod: 'Transferencia', type: 'Ingreso' }, total: 30000 },
    ]);

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.subtotalesPorMedioPago).toEqual({
      Efectivo: { Ingreso: 5000, Egreso: 1200 },
      Transferencia: { Ingreso: 30000, Egreso: 0 },
    });
  });

  it('should filter by search across concept/responsable/socioNombre', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { search: 'alquiler' }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg.$or).toHaveLength(3);
    expect(callArg.$or[0].concept.test('Alquiler local')).toBe(true);
  });

  it('should escape regex special characters in search', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { search: '(test)' }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg.$or[0].concept.test('(test)')).toBe(true);
    expect(callArg.$or[0].concept.test('test')).toBe(false);
  });

  it('should filter by date range when desde/hasta provided', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    await getMovimientosHandler({ query: { desde: '2026-01-01', hasta: '2026-01-31' }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg.date.$gte).toEqual(new Date('2026-01-01T00:00:00.000Z'));
    expect(callArg.date.$lte).toEqual(new Date('2026-01-31T23:59:59.999Z'));
  });

  it('should ignore a non-ObjectId socioId (mongo operator injection)', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));

    const res = mockRes();
    // qs interpreta ?socioId[$ne]=null como un objeto, no un string
    await getMovimientosHandler({ query: { socioId: { $ne: 'null' } }, user: USER }, res);

    const callArg = Movimiento.find.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('socioId');
  });

  it('should apply a valid ObjectId socioId', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(0);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([]));
    const validId = '507f1f77bcf86cd799439011';

    const res = mockRes();
    await getMovimientosHandler({ query: { socioId: validId }, user: USER }, res);

    expect(Movimiento.find).toHaveBeenCalledWith(expect.objectContaining({ socioId: validId }));
  });

  it('buildDetalle scopes Socio/Etiqueta lookups by clubId', async () => {
    const mov = {
      _id: 'mov1',
      sourceModel: 'Cobro',
      sourceId: { items: [{ socioId: 'socio1', etiquetaId: 'etq1', periodo: '2026-01', amount: 5000 }] },
    };
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([mov]));
    vi.spyOn(Socio, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(Etiqueta, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    expect(Socio.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: USER.clubId }), expect.anything());
    expect(Etiqueta.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: USER.clubId }), expect.anything());
  });

  it('expone cobroId (id crudo del Cobro, no el objeto populado) cuando sourceModel es Cobro', async () => {
    const mov = {
      _id: 'mov1',
      sourceModel: 'Cobro',
      sourceId: { _id: 'cobro1', items: [{ socioId: 'socio1', etiquetaId: 'etq1', periodo: '2026-01', amount: 5000 }] },
    };
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([mov]));
    vi.spyOn(Socio, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(Etiqueta, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.movimientos[0].cobroId).toBe('cobro1');
  });

  it('cobroId queda null cuando el movimiento no viene de un Cobro (o el populate no matcheó nada)', async () => {
    const mov = { _id: 'mov1', sourceModel: 'Asistencia', sourceId: null };
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([mov]));

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.movimientos[0].cobroId).toBeNull();
  });

  it('expone participanteId cuando sourceModel es EventoParticipante', async () => {
    const mov = { _id: 'mov1', sourceModel: 'EventoParticipante', sourceId: { _id: 'part1' } };
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([mov]));

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    const body = res.json.mock.calls[0][0];
    expect(body.movimientos[0].participanteId).toBe('part1');
    expect(body.movimientos[0].cobroId).toBeNull();
  });

  it('buildDetalle resuelve la fecha exacta de una visita de Muro Libre vía asistenciaId', async () => {
    // item.periodo para Muro Libre es solo "AAAA-MM" (buildPeriodoFromFecha
    // trunca el día) — el detalle tiene que resolver la fecha real vía
    // asistenciaId, no confiar en periodo para saber qué día fue.
    const fecha = new Date('2026-01-15T12:00:00Z');
    const mov = {
      _id: 'mov1',
      sourceModel: 'Cobro',
      sourceId: { items: [{ socioId: 'socio1', etiquetaId: 'etq1', asistenciaId: 'asis1', periodo: '2026-01', amount: 5000 }] },
    };
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([mov]));
    vi.spyOn(Socio, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(Etiqueta, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(Asistencia, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: 'asis1', fecha }]) });

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    expect(Asistencia.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: USER.clubId, _id: { $in: ['asis1'] } }), expect.anything());
    const body = res.json.mock.calls[0][0];
    expect(body.movimientos[0].detalle[0].fecha).toEqual(fecha);
  });

  it('buildDetalle no llama Asistencia.find si ningún item tiene asistenciaId', async () => {
    const mov = {
      _id: 'mov1',
      sourceModel: 'Cobro',
      sourceId: { items: [{ socioId: 'socio1', etiquetaId: 'etq1', periodo: '2026-01', amount: 5000 }] },
    };
    vi.spyOn(Movimiento, 'countDocuments').mockResolvedValue(1);
    vi.spyOn(Movimiento, 'find').mockReturnValue(makeQuery([mov]));
    vi.spyOn(Socio, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(Etiqueta, 'find').mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    vi.spyOn(Asistencia, 'find');

    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);

    expect(Asistencia.find).not.toHaveBeenCalled();
  });

  it('should return 500 on unexpected error', async () => {
    vi.spyOn(Movimiento, 'countDocuments').mockRejectedValue(new Error('DB down'));
    const res = mockRes();
    await getMovimientosHandler({ query: {}, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getMovimientoByIdHandler', () => {
  const ID = '507f1f77bcf86cd799439011';
  const findOneQuery = (result) => ({
    populate: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(result),
  });

  afterEach(() => vi.restoreAllMocks());

  it('devuelve el movimiento con la misma forma que el listado, filtrando por club', async () => {
    const query = findOneQuery({ _id: ID, type: 'Ingreso', clubId: 'club1', active: true });
    vi.spyOn(Movimiento, 'findOne').mockReturnValue(query);

    const res = mockRes();
    await getMovimientoByIdHandler({ params: { id: ID }, user: USER }, res);

    expect(Movimiento.findOne).toHaveBeenCalledWith({ _id: ID, clubId: 'club1' });
    expect(query.populate).toHaveBeenCalledWith({ path: 'sourceId', match: { clubId: 'club1' } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ _id: ID, detalle: null, cobroId: null, participanteId: null }));
  });

  it('404 si no existe o es de otro club', async () => {
    vi.spyOn(Movimiento, 'findOne').mockReturnValue(findOneQuery(null));

    const res = mockRes();
    await getMovimientoByIdHandler({ params: { id: ID }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('400 con un id que no es un ObjectId, sin consultar la base', async () => {
    const spy = vi.spyOn(Movimiento, 'findOne');

    const res = mockRes();
    await getMovimientoByIdHandler({ params: { id: 'mercadopago-sin-vincular' }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(spy).not.toHaveBeenCalled();
  });
});
