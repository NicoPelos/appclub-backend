import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { crearVinculoFamiliar } from '../../services/crearVinculoFamiliar.service.js';
import { BusinessError } from '../../services/businessError.js';
import User from '../../../usuarios/models/User.js';
import Socio from '../../../socios/models/Socio.js';
import VinculoFamiliar from '../../models/VinculoFamiliar.js';
import { syncSocioUserFromSocio } from '../../../usuarios/services/userSync.js';
import { obtenerRolIdsPorSlugs } from '../../../roles/services/resolverRoles.service.js';

vi.mock('../../../usuarios/services/userSync.js', () => ({
  syncSocioUserFromSocio: vi.fn(),
}));

vi.mock('../../../roles/services/resolverRoles.service.js', () => ({
  obtenerRolIdsPorSlugs: vi.fn().mockResolvedValue(['rol-socio-id']),
}));

const CLUB_ID = 'club1';
const HIJO_ID = '507f1f77bcf86cd799439011';
const PADRE_ID = '507f1f77bcf86cd799439013';
const SOCIO_PAPA_ID = '507f1f77bcf86cd799439014';
const USER_PAPA_NUEVO_ID = '507f1f77bcf86cd799439015';
const USER_TUTOR_ID = '507f1f77bcf86cd799439016';
const VINCULO_EXISTENTE_ID = '507f1f77bcf86cd799439017';
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

// Socio.findOne encadena .session().lean(); User/VinculoFamiliar.findOne
// solo encadenan .session() — igual que en el código real (ver
// crearVinculoFamiliar.service.js), para que la transacción los pueda
// pasar por sesión.
const chainableFindOne = (result) => ({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });
const chainableFindOneSessionOnly = (result) => ({ session: vi.fn().mockResolvedValue(result) });

describe('crearVinculoFamiliar service (unit)', () => {
  let saveSpy;

  beforeEach(() => {
    vi.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: vi.fn(async (cb) => cb()),
      endSession: vi.fn(),
    });

    Socio.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: HIJO_ID, clubId: CLUB_ID }));
    User.findOne = vi.fn().mockReturnValue(chainableFindOneSessionOnly(null));
    VinculoFamiliar.findOne = vi.fn().mockReturnValue(chainableFindOneSessionOnly(null));

    saveSpy = vi.spyOn(VinculoFamiliar.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      return this;
    });
    vi.spyOn(User.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      return this;
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should fail with 404 when hijoSocioId does not exist', async () => {
    Socio.findOne.mockReturnValue(chainableFindOne(null));

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('should link to an existing padreUserId directly', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, active: true, socioId: null }));

    const { vinculo } = await crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } });

    expect(saveSpy).toHaveBeenCalledTimes(1);
    expect(String(vinculo.padreUserId)).toBe(PADRE_ID);
    expect(String(vinculo.hijoSocioId)).toBe(HIJO_ID);
  });

  it('should fail with 404 when padreUserId does not exist', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly(null));

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('should reuse the padreSocioId User if it already exists', async () => {
    Socio.findOne
      .mockReturnValueOnce(chainableFindOne({ _id: HIJO_ID, clubId: CLUB_ID })) // hijo
      .mockReturnValueOnce(chainableFindOne({ _id: SOCIO_PAPA_ID, clubId: CLUB_ID })); // padre socio
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, socioId: SOCIO_PAPA_ID, active: true }));

    const { vinculo, passwordTemporal } = await crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreSocioId: SOCIO_PAPA_ID } });

    expect(syncSocioUserFromSocio).not.toHaveBeenCalled();
    expect(String(vinculo.padreUserId)).toBe(PADRE_ID);
    expect(passwordTemporal).toBeNull();
  });

  it('should create the padre User via syncSocioUserFromSocio when padreSocioId has no User yet, and return the DNI as passwordTemporal', async () => {
    Socio.findOne
      .mockReturnValueOnce(chainableFindOne({ _id: HIJO_ID, clubId: CLUB_ID }))
      .mockReturnValueOnce(chainableFindOne({ _id: SOCIO_PAPA_ID, clubId: CLUB_ID, correoElectronico: 'papa@test.com', dni: '12345678' }));
    User.findOne.mockReturnValue(chainableFindOneSessionOnly(null));
    syncSocioUserFromSocio.mockResolvedValue({ _id: USER_PAPA_NUEVO_ID, socioId: SOCIO_PAPA_ID, active: true });

    const { vinculo, passwordTemporal } = await crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreSocioId: SOCIO_PAPA_ID } });

    expect(syncSocioUserFromSocio).toHaveBeenCalledTimes(1);
    expect(String(vinculo.padreUserId)).toBe(USER_PAPA_NUEVO_ID);
    expect(passwordTemporal).toBe('12345678');
  });

  it('should fail when padreSocioId has no email/dni to create a User', async () => {
    Socio.findOne
      .mockReturnValueOnce(chainableFindOne({ _id: HIJO_ID, clubId: CLUB_ID }))
      .mockReturnValueOnce(chainableFindOne({ _id: SOCIO_PAPA_ID, clubId: CLUB_ID }));
    User.findOne.mockReturnValue(chainableFindOneSessionOnly(null));
    syncSocioUserFromSocio.mockResolvedValue(null);

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreSocioId: SOCIO_PAPA_ID } }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('should reuse an existing User found by padreEmail', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: USER_TUTOR_ID, clubId: CLUB_ID, socioId: null, active: true }));

    const { vinculo, passwordTemporal } = await crearVinculoFamiliar({
      clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID,
      body: { padreEmail: 'tutor@test.com' },
    });

    expect(User.prototype.save).not.toHaveBeenCalled();
    expect(String(vinculo.padreUserId)).toBe(USER_TUTOR_ID);
    expect(passwordTemporal).toBeNull();
  });

  it('should create a brand-new tutor-only User when padreEmail has no match and padreNombre is given, and return a passwordTemporal', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly(null));

    const { vinculo, padre, passwordTemporal } = await crearVinculoFamiliar({
      clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID,
      body: { padreEmail: 'tutor-nuevo@test.com', padreNombre: 'Tutor Nuevo' },
    });

    expect(User.prototype.save).toHaveBeenCalledTimes(1);
    expect(padre.socioId).toBeUndefined();
    expect(padre.email).toBe('tutor-nuevo@test.com');
    expect(String(vinculo.padreUserId)).toBe(String(padre._id));
    expect(passwordTemporal).toEqual(expect.any(String));
    expect(passwordTemporal.length).toBeGreaterThan(0);
    expect(obtenerRolIdsPorSlugs).toHaveBeenCalledWith({ clubId: CLUB_ID, slugs: ['socio'] });
  });

  it('should fail when creating a new tutor without padreNombre', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly(null));

    await expect(crearVinculoFamiliar({
      clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID,
      body: { padreEmail: 'tutor-nuevo@test.com' },
    })).rejects.toMatchObject({ status: 400 });
  });

  it('should fail when none of padreUserId/padreSocioId/padreEmail is given', async () => {
    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: {} }))
      .rejects.toBeInstanceOf(BusinessError);
  });

  it('should fail when the padre is the same socio as the hijo', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, socioId: HIJO_ID }));

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toMatchObject({ message: 'Un socio no puede ser su propio tutor' });
  });

  it('should fail with 409 when the vínculo already exists', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, socioId: null }));
    VinculoFamiliar.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: VINCULO_EXISTENTE_ID }));

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('should map a unique-index race on vinculo.save() (code 11000) to 409, not 500 (appcarc-backend#72)', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, socioId: null }));
    const dupError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    saveSpy.mockRejectedValueOnce(dupError);

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toMatchObject({ status: 409 });
  });

  it('should propagate an unexpected error from vinculo.save() without swallowing it', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, socioId: null }));
    saveSpy.mockRejectedValueOnce(new Error('DB down'));

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toThrow('DB down');
  });

  it('should call session.endSession() even when the transaction fails', async () => {
    const endSession = vi.fn();
    mongoose.startSession.mockResolvedValue({
      withTransaction: vi.fn(async (cb) => cb()),
      endSession,
    });
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: PADRE_ID, clubId: CLUB_ID, socioId: null }));
    saveSpy.mockRejectedValueOnce(new Error('DB down'));

    await expect(crearVinculoFamiliar({ clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID, body: { padreUserId: PADRE_ID } }))
      .rejects.toThrow('DB down');

    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it('should reject a padreEmail whose existing User is inactive (appcarc-backend#254)', async () => {
    User.findOne.mockReturnValue(chainableFindOneSessionOnly({ _id: USER_TUTOR_ID, clubId: CLUB_ID, socioId: null, active: false }));

    await expect(crearVinculoFamiliar({
      clubId: CLUB_ID, user: USER, hijoSocioId: HIJO_ID,
      body: { padreEmail: 'tutor@test.com' },
    })).rejects.toBeInstanceOf(BusinessError);
  });
});
