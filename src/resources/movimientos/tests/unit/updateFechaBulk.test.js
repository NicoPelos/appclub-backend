import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateFechaBulkHandler } from '../../handlers/updateFechaBulk.handler.js';
import Movimiento from '../../models/Movimiento.js';
import { logAudit } from '../../../audit/services/audit.service.js';

vi.mock('../../../audit/services/audit.service.js', () => ({ logAudit: vi.fn() }));

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { id: 'user1', email: 'admin@carc.test', clubId: 'club1' };
const ID_1 = '507f1f77bcf86cd799439011';
const ID_2 = '507f1f77bcf86cd799439012';
const FECHA = '2026-09-26T12:00:00.000Z';

const makeMovimiento = (id) => ({
  _id: id,
  date: new Date('2026-10-01T00:00:00.000Z'),
  updatedBy: '',
  save: vi.fn().mockResolvedValue(undefined),
  toObject: vi.fn().mockReturnValue({ _id: id }),
});

describe('updateFechaBulkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return 400 when ids is missing or empty', async () => {
    const res = mockRes();
    await updateFechaBulkHandler({ body: { ids: [], date: FECHA }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when more than 200 ids are sent', async () => {
    const ids = Array.from({ length: 201 }, () => ID_1);
    const res = mockRes();
    await updateFechaBulkHandler({ body: { ids, date: FECHA }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when an id is not a valid ObjectId', async () => {
    const res = mockRes();
    await updateFechaBulkHandler({ body: { ids: [ID_1, 'abc'], date: FECHA }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 when the date is invalid', async () => {
    const res = mockRes();
    await updateFechaBulkHandler({ body: { ids: [ID_1], date: 'no-es-fecha' }, user: USER }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should update the date of every movimiento of the club and audit each change', async () => {
    const m1 = makeMovimiento(ID_1);
    const m2 = makeMovimiento(ID_2);
    const findSpy = vi.spyOn(Movimiento, 'find').mockResolvedValue([m1, m2]);
    const res = mockRes();

    await updateFechaBulkHandler({ body: { ids: [ID_1, ID_2], date: FECHA }, user: USER }, res);

    expect(findSpy).toHaveBeenCalledWith({ _id: { $in: [ID_1, ID_2] }, clubId: 'club1', active: true });
    expect(m1.date).toEqual(new Date(FECHA));
    expect(m2.date).toEqual(new Date(FECHA));
    expect(m1.updatedBy).toBe('admin@carc.test');
    expect(m1.save).toHaveBeenCalled();
    expect(m2.save).toHaveBeenCalled();
    expect(logAudit).toHaveBeenCalledTimes(2);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ actualizados: 2, ignorados: 0 });
  });

  it('should report ignored ids that are not found or not from the club', async () => {
    const m1 = makeMovimiento(ID_1);
    vi.spyOn(Movimiento, 'find').mockResolvedValue([m1]);
    const res = mockRes();

    await updateFechaBulkHandler({ body: { ids: [ID_1, ID_2], date: FECHA }, user: USER }, res);

    expect(res.json).toHaveBeenCalledWith({ actualizados: 1, ignorados: 1 });
  });

  it('should count duplicated ids only once', async () => {
    const m1 = makeMovimiento(ID_1);
    const findSpy = vi.spyOn(Movimiento, 'find').mockResolvedValue([m1]);
    const res = mockRes();

    await updateFechaBulkHandler({ body: { ids: [ID_1, ID_1], date: FECHA }, user: USER }, res);

    expect(findSpy).toHaveBeenCalledWith({ _id: { $in: [ID_1] }, clubId: 'club1', active: true });
    expect(res.json).toHaveBeenCalledWith({ actualizados: 1, ignorados: 0 });
  });

  it('should return 500 when the database fails', async () => {
    vi.spyOn(Movimiento, 'find').mockRejectedValue(new Error('db down'));
    const res = mockRes();

    await updateFechaBulkHandler({ body: { ids: [ID_1], date: FECHA }, user: USER }, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
