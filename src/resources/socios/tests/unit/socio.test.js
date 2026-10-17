import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/socioSheetSync.js', () => ({ syncSocioToSheet: vi.fn().mockResolvedValue() }));
vi.mock('../../services/socioData.service.js', () => ({
  prepareSocioCreateData: vi.fn((body, user) => ({ ...body, clubId: body?.clubId || user?.clubId, createdBy: user?.id, updatedBy: user?.id })),
  prepareSocioUpdateData: vi.fn((body) => body),
  syncSocioUserIfPossible: vi.fn().mockResolvedValue(),
  asignarSocioNumber: vi.fn().mockResolvedValue('42'),
}));
vi.mock('../../../services/pushNotification.service.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue(),
  notifyRolesByPermiso: vi.fn().mockResolvedValue(),
}));
vi.mock('../../../usuarios/models/User.js', () => ({ default: { findOne: vi.fn().mockResolvedValue(null), find: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) }) } }));
vi.mock('../../../vinculos/services/anularVinculosFamiliares.service.js', () => ({ anularVinculosFamiliares: vi.fn().mockResolvedValue() }));
vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../advertencias/models/Advertencia.js', () => ({ default: { updateMany: vi.fn().mockResolvedValue({}) } }));

import { createSocioHandler } from '../../handlers/createSocio.handler.js';
import { getSociosHandler } from '../../handlers/getSocios.handler.js';
import { getSocioByIdHandler } from '../../handlers/getSocioById.handler.js';
import { updateSocioHandler } from '../../handlers/updateSocio.handler.js';
import { deleteSocioHandler } from '../../handlers/deleteSocio.handler.js';
import { restoreSocioHandler } from '../../handlers/restoreSocio.handler.js';
import Socio from '../../models/Socio.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import User from '../../../usuarios/models/User.js';
import { asignarSocioNumber } from '../../services/socioData.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

describe('Socios handlers (unit)', () => {
  beforeEach(() => {
    // stub static and instance methods on Socio
    Socio.find = vi.fn();
    Socio.findOne = vi.fn();
    Socio.findOneAndUpdate = vi.fn();
    Socio.countDocuments = vi.fn();
    Suscripcion.find.mockResolvedValue([]);
    delete process.env.GOOGLE_SHEETS_SOCIOS_ID;
    if (Socio.prototype && !Socio.prototype.save.isMockFunction) {
      vi.spyOn(Socio.prototype, 'save').mockImplementation(async function () { return this; });
    }
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockSocioFindQuery = (result) => {
    const query = {};
    query.sort = vi.fn(() => query);
    query.skip = vi.fn(() => query);
    query.limit = vi.fn(() => Promise.resolve(result));
    Socio.find.mockReturnValue(query);
    return query;
  };

  it('createSocioHandler should create a socio and return 201', async () => {
    const req = { body: { apellido: 'Perez', nombre: 'Juan', dni: '123' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await createSocioHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalled();
    const createdSocio = res.json.mock.calls[0][0];
    expect(createdSocio.createdBy).toBe('user1');
    expect(createdSocio.updatedBy).toBe('user1');
    expect(asignarSocioNumber).toHaveBeenCalledWith('club1');
    expect(createdSocio.socioNumber).toBe('42');
  });

  it('createSocioHandler no pisa un socioNumber explícito (ej. importación desde Sheets)', async () => {
    const req = { body: { apellido: 'Perez', nombre: 'Juan', dni: '123', socioNumber: '7' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await createSocioHandler(req, res);

    expect(asignarSocioNumber).not.toHaveBeenCalled();
    const createdSocio = res.json.mock.calls[0][0];
    expect(createdSocio.socioNumber).toBe('7');
  });

  it('getSociosHandler should return array of socios', async () => {
    const fake = [{ apellido: 'Perez', nombre: 'Juan' }];
    Socio.countDocuments.mockResolvedValueOnce(1);
    mockSocioFindQuery(fake);
    const req = { user: { clubId: 'club1' }, query: {} };
    const res = mockRes();

    await getSociosHandler(req, res);

    expect(Socio.find).toHaveBeenCalledWith({ clubId: 'club1', active: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
      socios: fake,
    });
  });

  it('getSocioByIdHandler should return socio when found, with userId (null si no tiene cuenta)', async () => {
    const fake = { _id: 'id1', apellido: 'Perez' };
    Socio.findOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(fake) });
    const req = { params: { id: 'id1' }, user: { clubId: 'club1' } };
    const res = mockRes();

    await getSocioByIdHandler(req, res);

    expect(Socio.findOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...fake, userId: null });
  });

  it('getSocioByIdHandler incluye el userId real cuando el socio tiene cuenta asociada', async () => {
    const fake = { _id: 'id1', apellido: 'Perez' };
    Socio.findOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(fake) });
    User.findOne.mockResolvedValueOnce({ _id: 'user-99' });
    const req = { params: { id: 'id1' }, user: { clubId: 'club1' } };
    const res = mockRes();

    await getSocioByIdHandler(req, res);

    expect(res.json).toHaveBeenCalledWith({ ...fake, userId: 'user-99' });
  });

  it('getSocioByIdHandler should return 403 when socio-only user tries to view another socio', async () => {
    const req = { params: { id: 'otro-id' }, user: { clubId: 'club1', roles: ['socio'], socioId: 'mi-id' } };
    const res = mockRes();

    await getSocioByIdHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(Socio.findOne).not.toHaveBeenCalled();
  });

  it('getSocioByIdHandler should allow socio to view own profile', async () => {
    const fake = { _id: 'mi-id', apellido: 'Yo' };
    Socio.findOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(fake) });
    const req = { params: { id: 'mi-id' }, user: { clubId: 'club1', roles: ['socio'], socioId: 'mi-id' } };
    const res = mockRes();

    await getSocioByIdHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ...fake, userId: null });
  });

  it('updateSocioHandler should update and return socio', async () => {
    const fake = { _id: 'id1', apellido: 'Perez', toObject: vi.fn().mockReturnValue({}) };
    Socio.findOne.mockResolvedValueOnce(fake);
    Socio.findOneAndUpdate.mockResolvedValueOnce(fake);
    const req = { params: { id: 'id1' }, body: { nombre: 'Updated' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await updateSocioHandler(req, res);

    expect(Socio.findOneAndUpdate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fake);
  });

  it('updateSocioHandler cierra automáticamente las suscripciones activas al pasar a Baja', async () => {
    const socioAntes = { _id: 'id1', apellido: 'Perez', estado: 'Activo', toObject: vi.fn().mockReturnValue({ estado: 'Activo' }) };
    const socioDespues = { _id: 'id1', apellido: 'Perez', estado: 'Baja', toObject: vi.fn().mockReturnValue({ estado: 'Baja' }) };
    Socio.findOne.mockResolvedValueOnce(socioAntes);
    Socio.findOneAndUpdate.mockResolvedValueOnce(socioDespues);

    const susActiva = { _id: 'sus1', fechaHasta: null, toObject: vi.fn().mockReturnValue({}), save: vi.fn().mockResolvedValue(undefined) };
    Suscripcion.find.mockResolvedValueOnce([susActiva]);
    User.findOne.mockReturnValueOnce({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });

    const req = { params: { id: 'id1' }, body: { estado: 'Baja' }, user: { clubId: 'club1', id: 'user1', email: 'admin@carc.test' } };
    const res = mockRes();

    await updateSocioHandler(req, res);

    expect(Suscripcion.find).toHaveBeenCalledWith({ clubId: 'club1', socioId: 'id1', active: true, fechaHasta: null });
    expect(susActiva.fechaHasta).toMatch(/^\d{4}-\d{2}$/);
    expect(susActiva.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('updateSocioHandler no toca Suscripciones si el estado no cambia a Baja', async () => {
    const socioAntes = { _id: 'id1', apellido: 'Perez', estado: 'Activo', toObject: vi.fn().mockReturnValue({ estado: 'Activo' }) };
    const socioDespues = { _id: 'id1', apellido: 'Actualizado', estado: 'Activo', toObject: vi.fn().mockReturnValue({ estado: 'Activo' }) };
    Socio.findOne.mockResolvedValueOnce(socioAntes);
    Socio.findOneAndUpdate.mockResolvedValueOnce(socioDespues);

    const req = { params: { id: 'id1' }, body: { nombre: 'Actualizado' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await updateSocioHandler(req, res);

    expect(Suscripcion.find).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('deleteSocioHandler should soft-delete and return success message', async () => {
    const fake = { _id: 'id1', apellido: 'Perez' };
    Socio.findOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(fake) });
    Socio.findOneAndUpdate.mockResolvedValueOnce(fake);
    const req = { params: { id: 'id1' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await deleteSocioHandler(req, res);

    expect(Socio.findOneAndUpdate).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: 'Socio desactivado con éxito' });
  });

  it('deleteSocioHandler cierra las suscripciones activas del socio (mismo efecto que la baja por PUT)', async () => {
    const fake = { _id: 'id1', apellido: 'Perez' };
    Socio.findOne.mockReturnValueOnce({ lean: vi.fn().mockResolvedValue(fake) });
    Socio.findOneAndUpdate.mockResolvedValueOnce(fake);

    const susActiva = { _id: 'sus1', fechaHasta: null, toObject: vi.fn().mockReturnValue({}), save: vi.fn().mockResolvedValue(undefined) };
    Suscripcion.find.mockResolvedValueOnce([susActiva]);

    const req = { params: { id: 'id1' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await deleteSocioHandler(req, res);

    expect(Suscripcion.find).toHaveBeenCalledWith({ clubId: 'club1', socioId: 'id1', active: true, fechaHasta: null });
    expect(susActiva.fechaHasta).toMatch(/^\d{4}-\d{2}$/);
    expect(susActiva.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('getSociosHandler should return trashed socios when trash=true', async () => {
    const fake = [{ apellido: 'Perez', nombre: 'Juan', active: false }];
    Socio.countDocuments.mockResolvedValueOnce(1);
    mockSocioFindQuery(fake);
    const req = { user: { clubId: 'club1' }, query: { trash: 'true' } };
    const res = mockRes();

    await getSociosHandler(req, res);

    expect(Socio.find).toHaveBeenCalledWith({ clubId: 'club1', active: false });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      page: 1,
      limit: 10,
      total: 1,
      totalPages: 1,
      socios: fake,
    });
  });

  it('restoreSocioHandler should restore a trashed socio', async () => {
    const fake = { _id: 'id1', apellido: 'Perez', active: true, toObject: vi.fn().mockReturnValue({}) };
    Socio.findOneAndUpdate.mockResolvedValueOnce(fake);
    const req = { params: { id: 'id1' }, user: { clubId: 'club1', id: 'user1' } };
    const res = mockRes();

    await restoreSocioHandler(req, res);

    expect(Socio.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: 'id1', clubId: 'club1', active: false },
      expect.objectContaining({
        active: true,
        deletedAt: undefined,
        deletedBy: undefined,
        updatedBy: 'user1',
      }),
      { returnDocument: 'after' }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(fake);
  });
});
