import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../models/AuditLog.js', () => ({
  default: { findOne: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn() },
}));

vi.mock('../../services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

vi.mock('../../services/reversers/index.js', () => ({
  REVERSERS: {},
}));

import { revertAuditLogHandler } from '../../handlers/revertAuditLog.handler.js';
import AuditLog from '../../models/AuditLog.js';
import { REVERSERS } from '../../services/reversers/index.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const VALID_ID = '507f1f77bcf86cd799439011';
const USER = { id: VALID_ID, email: 'admin@test.com', clubId: 'club1' };

const buildLog = (overrides = {}) => ({
  _id: VALID_ID,
  clubId: 'club1',
  action: 'UPDATE',
  resource: 'Socio',
  resourceId: VALID_ID,
  before: { nombre: 'Antes' },
  after: { nombre: 'Despues' },
  revertedAt: null,
  revertedBy: null,
  ...overrides,
});

// Deja tanto el 404/409 (findOne) como el reclamo atómico (findOneAndUpdate)
// resolviendo el mismo log — el flujo feliz de la mayoría de los tests.
const mockClaimable = (log) => {
  AuditLog.findOne.mockResolvedValue(log);
  AuditLog.findOneAndUpdate.mockResolvedValue(log);
};

describe('revertAuditLogHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(REVERSERS).forEach((key) => delete REVERSERS[key]);
    AuditLog.updateOne.mockResolvedValue({});
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: vi.fn(async (cb) => cb()),
      endSession: vi.fn(),
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('devuelve 400 si el id es inválido', async () => {
    const req = { params: { id: 'no-es-valid' }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('devuelve 404 si el log no existe', async () => {
    AuditLog.findOne.mockResolvedValue(null);
    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('devuelve 409 si ya fue revertido', async () => {
    AuditLog.findOne.mockResolvedValue(buildLog({ revertedAt: new Date() }));
    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('revierte un UPDATE restaurando before', async () => {
    const log = buildLog({ action: 'UPDATE', before: { nombre: 'Antes', active: true } });
    mockClaimable(log);

    const mockUpdate = vi.fn().mockResolvedValue({ _id: VALID_ID });
    vi.spyOn(mongoose, 'model').mockReturnValue({ findOneAndUpdate: mockUpdate });

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(mockUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: log.clubId },
      { $set: expect.objectContaining({ nombre: 'Antes', active: true }) },
    );
    // appcarc-backend#222: el revertedAt/revertedBy ya se persistió en el
    // reclamo atómico (findOneAndUpdate), no con un log.save() al final.
    expect(AuditLog.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: 'club1', revertedAt: null },
      { $set: expect.objectContaining({ revertedBy: USER.email }) },
      {},
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('revierte un DELETE restaurando before', async () => {
    const log = buildLog({ action: 'DELETE', before: { nombre: 'Antes', active: true, deletedAt: null }, after: null });
    mockClaimable(log);

    const mockUpdate = vi.fn().mockResolvedValue({ _id: VALID_ID });
    vi.spyOn(mongoose, 'model').mockReturnValue({ findOneAndUpdate: mockUpdate });

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(mockUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: log.clubId },
      { $set: expect.objectContaining({ active: true, deletedAt: null }) },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('revierte un CREATE haciendo soft-delete', async () => {
    const log = buildLog({ action: 'CREATE', before: null });
    mockClaimable(log);

    const mockUpdate = vi.fn().mockResolvedValue({ _id: VALID_ID });
    vi.spyOn(mongoose, 'model').mockReturnValue({ findOneAndUpdate: mockUpdate });

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(mockUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: log.clubId },
      { $set: expect.objectContaining({ active: false }) },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('devuelve 422 si no hay snapshot before para UPDATE, y deshace el reclamo', async () => {
    const log = buildLog({ action: 'UPDATE', before: null });
    mockClaimable(log);

    vi.spyOn(mongoose, 'model').mockReturnValue({});

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);
    expect(res.status).toHaveBeenCalledWith(422);
    // appcarc-backend#222: falló después de reclamar → hay que deshacer el
    // reclamo para poder reintentar de verdad, no dejarlo revertido en falso.
    expect(AuditLog.updateOne).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: 'club1' },
      { $set: { revertedAt: null, revertedBy: null } },
    );
  });

  it('devuelve 422 y deshace el reclamo si el documento no pertenece a este club (appcarc-backend#91)', async () => {
    const log = buildLog({ action: 'UPDATE', before: { nombre: 'Antes' } });
    mockClaimable(log);

    const mockUpdate = vi.fn().mockResolvedValue(null);
    vi.spyOn(mongoose, 'model').mockReturnValue({ findOneAndUpdate: mockUpdate });

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(AuditLog.updateOne).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: 'club1' },
      { $set: { revertedAt: null, revertedBy: null } },
    );
  });

  it('appcarc-backend#222: si el reclamo atómico no matchea (ya lo ganó otro request en simultáneo), responde 409 sin ejecutar nada', async () => {
    const log = buildLog({ action: 'UPDATE', before: { nombre: 'Antes' } });
    AuditLog.findOne.mockResolvedValue(log); // preCheck: todavía parece no revertido
    AuditLog.findOneAndUpdate.mockResolvedValue(null); // pero el reclamo atómico perdió la carrera
    const modelSpy = vi.spyOn(mongoose, 'model');

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(modelSpy).not.toHaveBeenCalled();
    expect(AuditLog.updateOne).not.toHaveBeenCalled();
  });

  it('delega en el reverser registrado en vez del genérico, para recursos con cascada', async () => {
    const log = buildLog({ resource: 'Cobro', action: 'DELETE', before: { movimientoId: 'mov1' } });
    mockClaimable(log);

    const reverser = vi.fn().mockResolvedValue(undefined);
    REVERSERS.Cobro = reverser;
    const modelSpy = vi.spyOn(mongoose, 'model');

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(reverser).toHaveBeenCalledWith(log, expect.objectContaining({ actor: USER.email }));
    expect(modelSpy).not.toHaveBeenCalled();
    // El reclamo fue DENTRO de la transacción del reverser (con session).
    expect(AuditLog.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: VALID_ID, clubId: 'club1', revertedAt: null },
      { $set: expect.objectContaining({ revertedBy: USER.email }) },
      { session: expect.anything() },
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('propaga el status de error de un reverser (ej. 422 sin snapshot), sin necesitar deshacer el reclamo a mano', async () => {
    const log = buildLog({ resource: 'Cobro', action: 'DELETE', before: null });
    mockClaimable(log);

    const error = new Error('No hay snapshot anterior para revertir');
    error.status = 422;
    REVERSERS.Cobro = vi.fn().mockRejectedValue(error);

    const req = { params: { id: VALID_ID }, user: USER };
    const res = mockRes();
    await revertAuditLogHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(422);
    // El reclamo fue parte de la misma transacción que el reverser — Mongo
    // la deshace sola al tirar adentro de withTransaction, no hace falta
    // (ni se puede) deshacerla a mano acá.
    expect(AuditLog.updateOne).not.toHaveBeenCalled();
  });
});
