import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../resources/usuarios/models/User.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../resources/escuelita/models/Escuelita.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../resources/socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../resources/cuotas/services/calcularDeuda.service.js', () => ({
  calcularDeuda: vi.fn(),
}));
vi.mock('../../../services/pushNotification.service.js', () => ({
  sendPushNotification: vi.fn().mockResolvedValue({ sent: 1 }),
  notifyJobFailure: vi.fn().mockResolvedValue(undefined),
}));

import cron from 'node-cron';

let cronCallback;
vi.mock('node-cron', () => ({
  default: { schedule: vi.fn((_expr, cb) => { cronCallback = cb; }) },
}));

import { enviarRecordatorios, startRecordatorioCuotasJob } from '../../recordatorioCuotas.job.js';
import User from '../../../resources/usuarios/models/User.js';
import Escuelita from '../../../resources/escuelita/models/Escuelita.js';
import Socio from '../../../resources/socios/models/Socio.js';
import { calcularDeuda } from '../../../resources/cuotas/services/calcularDeuda.service.js';
import { sendPushNotification, notifyJobFailure } from '../../../services/pushNotification.service.js';

const mockSelectLean = (result) => ({ select: () => ({ lean: () => Promise.resolve(result) }) });

// Escuelita.findOne(...).populate(...).lean() — por defecto "no inscripto".
const mockAlumno = (etiquetaId = null) => ({
  populate: () => ({ lean: () => Promise.resolve(etiquetaId ? { planId: { etiquetaId } } : null) }),
});

// Socio.find(filtro).select().lean() sobre una "base" en memoria: aplica el
// filtro que recibe (clubId, active, estado $in, _id $in), así los tests
// verifican la consulta real del job y no solo lo que devuelve el mock.
let sociosDb;
const mockSocioFind = (filtro) => mockSelectLean(sociosDb.filter((s) => (
  s.clubId === filtro.clubId
  && s.active === filtro.active
  && filtro.estado.$in.includes(s.estado)
  && filtro._id.$in.includes(s._id)
)));

const user = { _id: 'u1', socioId: 'socio1', clubId: 'CARC', expoPushToken: 'ExponentPushToken[xxx]' };
const ETIQUETA_ESCUELITA_ID = 'etiqueta-escuelita-1';
const deudaSocial = (mesesDeuda) => ({
  suscripciones: [{ etiqueta: { uso_sistema: 'cuota_social' }, mesesDeuda }],
  otrosCargos: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  sociosDb = [{ _id: 'socio1', clubId: 'CARC', active: true, estado: 'Activo' }];
  Socio.find.mockImplementation(mockSocioFind);
  User.find.mockReturnValue(mockSelectLean([user]));
  Escuelita.findOne.mockReturnValue(mockAlumno());
});

describe('enviarRecordatorios', () => {
  it('avisa cuando el socio debe cuota social', async () => {
    calcularDeuda.mockResolvedValue({
      suscripciones: [{ etiqueta: { uso_sistema: 'cuota_social' }, mesesDeuda: 2 }],
      otrosCargos: [],
    });

    await enviarRecordatorios();

    expect(sendPushNotification).toHaveBeenCalledWith(
      [{ userId: 'u1', clubId: 'CARC', token: 'ExponentPushToken[xxx]' }],
      expect.objectContaining({ body: expect.stringContaining('cuota social (2 meses)') }),
    );
  });

  it('avisa cuando el socio debe escuelita (etiqueta con uso_sistema cuota_escuelita)', async () => {
    calcularDeuda.mockResolvedValue({
      suscripciones: [{ etiqueta: { _id: ETIQUETA_ESCUELITA_ID, uso_sistema: 'cuota_escuelita' }, mesesDeuda: 1 }],
      otrosCargos: [],
    });
    Escuelita.findOne.mockReturnValue(mockAlumno(ETIQUETA_ESCUELITA_ID));

    await enviarRecordatorios();

    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining('escuelita (1 mes)') }),
    );
  });

  it('BUG appcarc-backend#156: avisa la deuda de escuelita también para un plan cuya etiqueta NO tiene uso_sistema cuota_escuelita (ej. AvanzadosX1)', async () => {
    const ETIQUETA_X1_ID = 'etiqueta-escuelita-x1';
    calcularDeuda.mockResolvedValue({
      suscripciones: [{ etiqueta: { _id: ETIQUETA_X1_ID, uso_sistema: null, nombre: 'Cuota Escuelita x 1' }, mesesDeuda: 3 }],
      otrosCargos: [],
    });
    Escuelita.findOne.mockReturnValue(mockAlumno(ETIQUETA_X1_ID));

    await enviarRecordatorios();

    expect(sendPushNotification).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ body: expect.stringContaining('escuelita (3 meses)') }),
    );
  });

  it('no avisa si está al día', async () => {
    calcularDeuda.mockResolvedValue({
      suscripciones: [{ etiqueta: { uso_sistema: 'cuota_social' }, mesesDeuda: 0 }],
      otrosCargos: [],
    });

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('no avisa escuelita si el socio no está inscripto (no hay etiqueta que resolver)', async () => {
    calcularDeuda.mockResolvedValue({
      suscripciones: [{ etiqueta: { _id: ETIQUETA_ESCUELITA_ID, uso_sistema: 'cuota_escuelita' }, mesesDeuda: 1 }],
      otrosCargos: [],
    });
    Escuelita.findOne.mockReturnValue(mockAlumno(null));

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('no revienta si un socio falla', async () => {
    calcularDeuda.mockRejectedValue(new Error('DB error'));

    await expect(enviarRecordatorios()).resolves.not.toThrow();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });
});

describe('enviarRecordatorios — estado del socio (appcarc-backend#307)', () => {
  const conEstado = (estado) => { sociosDb = [{ _id: 'socio1', clubId: 'CARC', active: true, estado }]; };

  it('no avisa a un socio en Baja aunque tenga deuda y token de push', async () => {
    conEstado('Baja');
    calcularDeuda.mockResolvedValue(deudaSocial(4));

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(calcularDeuda).not.toHaveBeenCalled();
  });

  it.each(['Activo', 'Adherente'])('avisa a un socio %s con deuda', async (estado) => {
    conEstado(estado);
    calcularDeuda.mockResolvedValue(deudaSocial(2));

    await enviarRecordatorios();

    expect(sendPushNotification).toHaveBeenCalledTimes(1);
  });

  it('no avisa si el socio del usuario no existe', async () => {
    sociosDb = [];
    calcularDeuda.mockResolvedValue(deudaSocial(2));

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it.each([
    ['sin estado', undefined],
    ["con estado en minúscula ('activo')", 'activo'],
  ])('no avisa a un socio %s (misma regla exacta que getSociosMorosos)', async (_caso, estado) => {
    conEstado(estado);
    calcularDeuda.mockResolvedValue(deudaSocial(2));

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('no avisa a un socio borrado (active: false)', async () => {
    sociosDb = [{ _id: 'socio1', clubId: 'CARC', active: false, estado: 'Activo' }];
    calcularDeuda.mockResolvedValue(deudaSocial(2));

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('no cruza clubes: un socio vigente de otro club no habilita al usuario', async () => {
    sociosDb = [{ _id: 'socio1', clubId: 'OTRO', active: true, estado: 'Activo' }];
    calcularDeuda.mockResolvedValue(deudaSocial(2));

    await enviarRecordatorios();

    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it('consulta los socios una sola vez por club, filtrando por clubId', async () => {
    sociosDb = [
      { _id: 'socio1', clubId: 'CARC', active: true, estado: 'Activo' },
      { _id: 'socio2', clubId: 'CARC', active: true, estado: 'Baja' },
      { _id: 'socio3', clubId: 'DEMO', active: true, estado: 'Adherente' },
    ];
    User.find.mockReturnValue(mockSelectLean([
      user,
      { _id: 'u2', socioId: 'socio2', clubId: 'CARC', expoPushToken: 'tok2' },
      { _id: 'u3', socioId: 'socio3', clubId: 'DEMO', expoPushToken: 'tok3' },
    ]));
    calcularDeuda.mockResolvedValue(deudaSocial(1));

    await enviarRecordatorios();

    expect(Socio.find).toHaveBeenCalledTimes(2);
    expect(Socio.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', _id: { $in: ['socio1', 'socio2'] } }));
    expect(Socio.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'DEMO', _id: { $in: ['socio3'] } }));
    const tokens = sendPushNotification.mock.calls.map(([dest]) => dest[0].token);
    expect(tokens).toEqual(['ExponentPushToken[xxx]', 'tok3']);
  });
});

describe('startRecordatorioCuotasJob', () => {
  it('se programa en hora argentina, no en la del container (appcarc-backend#283)', () => {
    cron.schedule.mockClear();
    startRecordatorioCuotasJob();
    expect(cron.schedule).toHaveBeenCalledWith('15 9 1 * *', expect.any(Function), { timezone: 'America/Argentina/Cordoba' });
  });

  it('avisa al admin si el job entero falla inesperadamente', async () => {
    User.find.mockImplementation(() => { throw new Error('Mongo caído'); });
    startRecordatorioCuotasJob();

    await cronCallback();

    expect(notifyJobFailure).toHaveBeenCalledWith('CARC', 'Recordatorio de cuotas', 'Mongo caído');
  });
});
