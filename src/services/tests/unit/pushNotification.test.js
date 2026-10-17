import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../resources/usuarios/models/User.js', () => ({
  default: { findOne: vi.fn(), find: vi.fn() },
}));
vi.mock('../../../resources/notificaciones/models/Notification.js', () => ({
  default: { insertMany: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../resources/vinculos/models/VinculoFamiliar.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../resources/roles/services/resolverRoles.service.js', () => ({
  obtenerRolIdsPorSlugs: vi.fn(),
}));
vi.mock('../../../resources/roles/models/Rol.js', () => ({
  default: { find: vi.fn() },
}));

import { notifySocio, sendPushNotification, notifyJobFailure, notifyRolesByPermiso } from '../../pushNotification.service.js';
import User from '../../../resources/usuarios/models/User.js';
import Notification from '../../../resources/notificaciones/models/Notification.js';
import VinculoFamiliar from '../../../resources/vinculos/models/VinculoFamiliar.js';
import Rol from '../../../resources/roles/models/Rol.js';
import { obtenerRolIdsPorSlugs } from '../../../resources/roles/services/resolverRoles.service.js';

const chainableFindOne = (result) => ({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });
const chainableFind = (result) => ({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });

describe('sendPushNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notification.insertMany.mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => vi.clearAllMocks());

  it('guarda socioId en el historial cuando se pasa', async () => {
    await sendPushNotification(
      [{ userId: 'u1', clubId: 'CARC', token: null }],
      { title: 't', body: 'b', socioId: 'socio1' },
    );
    expect(Notification.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'u1', clubId: 'CARC', socioId: 'socio1', title: 't', body: 'b' }),
    ]);
  });

  it('socioId queda null si no se pasa', async () => {
    await sendPushNotification([{ userId: 'u1', clubId: 'CARC', token: null }], { title: 't', body: 'b' });
    expect(Notification.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ socioId: null }),
    ]);
  });
});

describe('notifySocio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notification.insertMany.mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => vi.clearAllMocks());

  it('llega a la cuenta propia del socio si tiene una', async () => {
    User.findOne.mockReturnValue(chainableFindOne({ _id: 'userPropio', clubId: 'CARC', expoPushToken: null }));
    VinculoFamiliar.find.mockReturnValue(chainableFind([]));

    const result = await notifySocio('socio1', { title: 't', body: 'b' });

    expect(result.sent).toBe(0); // sin push token válido, pero se guarda igual en el historial
    expect(Notification.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'userPropio', socioId: 'socio1' }),
    ]);
  });

  it('bug real arreglado: un hijo vinculado sin cuenta propia le llega al tutor', async () => {
    User.findOne.mockReturnValue(chainableFindOne(null)); // el hijo no tiene cuenta propia
    VinculoFamiliar.find.mockReturnValue(chainableFind([{ padreUserId: 'tutor1' }]));
    User.find.mockReturnValue(chainableFind([{ _id: 'tutor1', clubId: 'CARC', expoPushToken: null }]));

    await notifySocio('hijoSocioId', { title: 't', body: 'b' });

    expect(Notification.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'tutor1', socioId: 'hijoSocioId' }),
    ]);
  });

  it('si tiene cuenta propia Y tutores vinculados, le llega a todos sin duplicar', async () => {
    User.findOne.mockReturnValue(chainableFindOne({ _id: 'userPropio', clubId: 'CARC', expoPushToken: null }));
    VinculoFamiliar.find.mockReturnValue(chainableFind([{ padreUserId: 'tutor1' }, { padreUserId: 'tutor2' }]));
    User.find.mockReturnValue(chainableFind([
      { _id: 'tutor1', clubId: 'CARC', expoPushToken: null },
      { _id: 'tutor2', clubId: 'CARC', expoPushToken: null },
    ]));

    await notifySocio('socio1', { title: 't', body: 'b' });

    const inserted = Notification.insertMany.mock.calls[0][0];
    expect(inserted.map((n) => n.userId)).toEqual(['userPropio', 'tutor1', 'tutor2']);
  });

  it('sin cuenta propia ni tutores, no manda nada (no explota)', async () => {
    User.findOne.mockReturnValue(chainableFindOne(null));
    VinculoFamiliar.find.mockReturnValue(chainableFind([]));

    const result = await notifySocio('socioHuerfano', { title: 't', body: 'b' });

    expect(result).toEqual({ sent: 0 });
    expect(Notification.insertMany).not.toHaveBeenCalled();
  });
});

describe('notifyRolesByPermiso', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notification.insertMany.mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });
  afterEach(() => vi.clearAllMocks());

  it('busca los roles del club que tengan el permiso, no por slug hardcodeado', async () => {
    Rol.find.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: 'rolConPermiso' }]) }) });
    User.find.mockReturnValue(chainableFind([{ _id: 'user1', clubId: 'CARC', expoPushToken: null }]));

    await notifyRolesByPermiso('CARC', 'advertencias:read', { title: 't', body: 'b' });

    expect(Rol.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true, permisos: 'advertencias:read' });
    expect(User.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true, roles: { $in: ['rolConPermiso'] } });
    expect(Notification.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({ userId: 'user1', clubId: 'CARC' }),
    ]);
  });

  it('un rol sin el permiso no recibe la notificación aunque su nombre coincida con lo que antes estaba hardcodeado', async () => {
    Rol.find.mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
    User.find.mockReturnValue(chainableFind([]));

    const result = await notifyRolesByPermiso('CARC', 'advertencias:read', { title: 't', body: 'b' });

    expect(User.find).toHaveBeenCalledWith({ clubId: 'CARC', active: true, roles: { $in: [] } });
    expect(result).toEqual({ sent: 0 });
  });
});

describe('notifyJobFailure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Notification.insertMany.mockResolvedValue([]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('avisa al rol admin del club con el nombre del job y el mensaje de error', async () => {
    obtenerRolIdsPorSlugs.mockResolvedValue(['rolAdmin']);
    User.find.mockReturnValue(chainableFind([{ _id: 'admin1', clubId: 'CARC', expoPushToken: null }]));

    await notifyJobFailure('CARC', 'Exportación a Google Sheets', 'timeout de la API');

    expect(obtenerRolIdsPorSlugs).toHaveBeenCalledWith({ clubId: 'CARC', slugs: ['admin'] });
    expect(Notification.insertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: 'admin1',
        clubId: 'CARC',
        title: '⚠️ Falló: Exportación a Google Sheets',
        body: 'timeout de la API',
      }),
    ]);
  });

  it('no explota si ni siquiera se puede avisar del error', async () => {
    obtenerRolIdsPorSlugs.mockRejectedValue(new Error('roles caídos'));

    await expect(notifyJobFailure('CARC', 'Job X', 'boom')).resolves.toBeUndefined();
  });
});
