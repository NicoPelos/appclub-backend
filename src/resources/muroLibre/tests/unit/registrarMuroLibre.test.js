import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

vi.mock('../../../cuotas/services/exencion.service.js', () => ({
  estaExentoEnPeriodo: vi.fn().mockResolvedValue(false),
}));

import { BusinessError, registrarMuroLibre, anularCuotaMuroLibreMensual } from '../../services/registrarMuroLibre.service.js';
import Socio from '../../../socios/models/Socio.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Precios from '../../../cuotas/models/Precios.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import { estaExentoEnPeriodo } from '../../../cuotas/services/exencion.service.js';

const CLUB_ID = 'club1';
const SOCIO_ID = '507f1f77bcf86cd799439011';
const ETIQUETA_ID = new mongoose.Types.ObjectId();
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

const mockSocioQuery = (result) => {
  const sessionQuery = { session: vi.fn().mockResolvedValue(result) };
  Socio.findOne.mockReturnValue(sessionQuery);
  return sessionQuery;
};

const mockEtiquetaQuery = (result = { _id: ETIQUETA_ID, uso_sistema: 'muro_libre_diario_no_socio' }) => {
  Etiqueta.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) });
};

// Rama mensual: Suscripcion.findOne(...).sort(...).session(...)
const mockSuscripcionMensualQuery = (result) => {
  Suscripcion.findOne = vi.fn().mockReturnValue({
    sort: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(result) }),
  });
};

const mockPrecioVigenteQuery = (result) => {
  const sessionQuery = { session: vi.fn().mockResolvedValue(result) };
  const sortQuery = { sort: vi.fn().mockReturnValue(sessionQuery) };
  Precios.findOne.mockReturnValue(sortQuery);
  return { sortQuery, sessionQuery };
};

describe('registrarMuroLibre service (unit)', () => {
  let sessionMock;
  let registroSaveSpy;
  let movimientoSaveSpy;
  let suscripcionSaveSpy;
  let cuotaSaveSpy;
  let savedRegistros;
  let savedMovimientos;
  let savedSuscripciones;
  let savedCuotas;

  beforeEach(() => {
    savedRegistros = [];
    savedMovimientos = [];
    savedSuscripciones = [];
    savedCuotas = [];

    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };

    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);

    Socio.findOne = vi.fn();
    Cuota.findOne = vi.fn();
    Precios.findOne = vi.fn();
    Etiqueta.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ETIQUETA_ID }) });
    mockSuscripcionMensualQuery(null);

    Asistencia.findOne = vi.fn().mockReturnValue({
      session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
    });

    registroSaveSpy = vi.spyOn(Asistencia.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedRegistros.push(this);
      return this;
    });

    movimientoSaveSpy = vi.spyOn(Movimiento.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedMovimientos.push(this);
      return this;
    });

    suscripcionSaveSpy = vi.spyOn(Suscripcion.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedSuscripciones.push(this);
      return this;
    });

    cuotaSaveSpy = vi.spyOn(Cuota.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedCuotas.push(this);
      return this;
    });
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it('should fail with 401 when clubId is missing', async () => {
    await expect(registrarMuroLibre({ clubId: undefined, user: USER, body: { tipoPase: 'diario' } }))
      .rejects.toMatchObject({ status: 401, message: 'No se pudo determinar el club del usuario' });

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should fail when tipoPase is invalid', async () => {
    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'anual' } }))
      .rejects.toMatchObject({ message: 'El tipo de pase debe ser diario o mensual' });

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should fail with BusinessError when fecha is invalid', async () => {
    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', fecha: 'no-es-fecha' } }))
      .rejects.toBeInstanceOf(BusinessError);

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('appcarc-backend#167: rechaza una fecha futura', async () => {
    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', fecha: '2099-01-01T12:00:00.000Z' } }))
      .rejects.toMatchObject({ message: 'La fecha de la asistencia no puede ser futura' });

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should fail with 404 when socioId is provided but socio does not exist', async () => {
    mockSocioQuery(null);

    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', socioId: SOCIO_ID } }))
      .rejects.toMatchObject({ status: 404 });

    expect(Precios.findOne).not.toHaveBeenCalled();
  });

  it('should fail when nombre is missing and no socio is linked', async () => {
    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', nombre: '' } }))
      .rejects.toMatchObject({ message: 'El nombre es obligatorio' });
  });

  it('should fail when estadoPago is invalid', async () => {
    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', nombre: 'Juan', estadoPago: 'gratis' } }))
      .rejects.toMatchObject({ message: 'El estado de pago debe ser pagado, pendiente o exento' });
  });

  it('should fail when estadoPago is pagado but paymentMethod is invalid', async () => {
    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', nombre: 'Juan', estadoPago: 'pagado', paymentMethod: 'Tarjeta' } }))
      .rejects.toMatchObject({ message: 'La forma de pago debe ser Efectivo o Transferencia' });
  });

  it('#317: pagado sin monto ni precio vigente → PRECIO_NO_VIGENTE con el pase y el mes', async () => {
    mockPrecioVigenteQuery(null);
    mockEtiquetaQuery({ _id: ETIQUETA_ID, nombre: 'Muro Libre diario no socio', uso_sistema: 'muro_libre_diario_no_socio' });

    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', nombre: 'Juan', estadoPago: 'pagado', paymentMethod: 'Efectivo', fecha: '2026-10-02T15:00:00.000Z' } }))
      .rejects.toMatchObject({
        status: 400,
        message: 'No hay precio vigente para «Muro Libre diario no socio» en octubre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
        data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: String(ETIQUETA_ID), etiquetaNombre: 'Muro Libre diario no socio', periodo: '2026-10' },
      });

    expect(Precios.findOne).toHaveBeenCalledTimes(1);
    expect(registroSaveSpy).not.toHaveBeenCalled();
  });

  it('#317: pagado con monto manual en 0 sigue siendo un error de monto, no de precio', async () => {
    mockPrecioVigenteQuery(null);

    await expect(registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', nombre: 'Juan', estadoPago: 'pagado', paymentMethod: 'Efectivo', amount: 0 } }))
      .rejects.toMatchObject({ message: 'El pago necesita un monto mayor que cero' });
    expect(registroSaveSpy).not.toHaveBeenCalled();
  });

  it('#317: un monto manual sigue funcionando aunque no haya precio vigente', async () => {
    mockPrecioVigenteQuery(null);

    await registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { tipoPase: 'diario', nombre: 'Juan', estadoPago: 'pagado', paymentMethod: 'Efectivo', amount: 4000 } });
    expect(savedRegistros[0]).toMatchObject({ estadoPago: 'pagado', monto: 4000 });
  });

  it('should register a non-socio, diario, pagado using precio vigente and create movimiento', async () => {
    mockPrecioVigenteQuery({ monto: 3000 });

    const result = await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', nombre: 'Juan', apellido: 'Pérez', estadoPago: 'pagado', paymentMethod: 'Efectivo' },
    });

    expect(registroSaveSpy).toHaveBeenCalledTimes(2);
    expect(movimientoSaveSpy).toHaveBeenCalledTimes(1);
    expect(savedRegistros[0]).toMatchObject({
      nombre: 'Juan', apellido: 'Pérez', esSocio: false,
      tipoPase: 'diario', estadoPago: 'pagado', monto: 3000,
      precioSugeridoSnapshot: 3000, formaPago: 'Efectivo', periodo: '',
    });
    expect(savedMovimientos[0]).toMatchObject({
      type: 'Ingreso', concept: 'Muro libre diario', paymentMethod: 'Efectivo', amount: 3000,
    });
    expect(result).toEqual({ registro: expect.anything(), movimiento: expect.anything(), advertencias: expect.any(Array) });
  });

  it.each([
    ['QR', 'staff-user-1'],
    ['DNI', 'staff-user-1'],
    ['SELF', 'socio-user-1'],
  ])('appcarc-backend#152: persiste scannedBy/checkinMethod de los parámetros de la función, no de body (método %s)', async (checkinMethod, scannedByParam) => {
    mockPrecioVigenteQuery({ monto: 3000 });

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: {
        tipoPase: 'diario', nombre: 'Juan', apellido: 'Pérez', estadoPago: 'pagado', paymentMethod: 'Efectivo',
        // valores arbitrarios en el body — no deberían usarse para nada.
        scannedBy: 'valor-que-mando-el-cliente', checkinMethod: 'OTRO',
      },
      scannedBy: scannedByParam,
      checkinMethod,
    });

    expect(savedRegistros[0]).toMatchObject({ scannedBy: scannedByParam, checkinMethod });
  });

  it('usa los defaults (scannedBy: null, checkinMethod: MANUAL) cuando no se pasan parámetros (alta manual de staff)', async () => {
    mockPrecioVigenteQuery({ monto: 3000 });

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', nombre: 'Juan', apellido: 'Pérez', estadoPago: 'pagado', paymentMethod: 'Efectivo' },
    });

    expect(savedRegistros[0]).toMatchObject({ scannedBy: null, checkinMethod: 'MANUAL' });
  });

  it('should register mensual attendance as exento when socio has a valid Cuota muro_libre', async () => {
    const socio = { _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' };
    mockSocioQuery(socio);
    mockPrecioVigenteQuery({ monto: 8000 });
    const paidCuota = { _id: new mongoose.Types.ObjectId(), estado: 'pagada' };
    // Primera llamada: cuota social (.session().lean()) — segunda: cuota mensual (.session())
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(paidCuota) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(paidCuota) });

    const result = await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', fecha: '2026-06-15T00:00:00.000Z' },
    });

    expect(savedRegistros[0]).toMatchObject({
      nombre: 'Ana', esSocio: true, tipoPase: 'mensual',
      estadoPago: 'exento', monto: 0, periodo: '2026-06', formaPago: 'Sin pago',
    });
    expect(movimientoSaveSpy).not.toHaveBeenCalled();
    expect(result.movimiento).toBeNull();
  });

  it('registra con advertencia PASE_MENSUAL_IMPAGO cuando no tiene pase mensual pagado (fuera de la ventana de gracia)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T15:00:00.000Z')); // día 15 (ART) — fuera de la ventana
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    // Primera llamada: cuota social — segunda: cuota mensual (sin pase)
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ estado: 'pagada' }) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });

    const result = await registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { socioId: SOCIO_ID, tipoPase: 'mensual' } });
    vi.useRealTimers();

    expect(result.advertencias).toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo: 'PASE_MENSUAL_IMPAGO' }),
    ]));
    expect(registroSaveSpy).toHaveBeenCalled();
    // Al no estar suscripto todavía, el check-in lo suscribe igual (aunque quede pendiente)
    expect(suscripcionSaveSpy).toHaveBeenCalledTimes(1);
    expect(cuotaSaveSpy).not.toHaveBeenCalled();
  });

  it('un socio con pase mensual exento (plan "No genera deuda") entra como exento y sin advertencias de pago', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-15T15:00:00.000Z')); // día 15 (ART) — fuera de la ventana
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });
    estaExentoEnPeriodo.mockResolvedValue(true); // exento en cuota social y en pase mensual

    const result = await registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { socioId: SOCIO_ID, tipoPase: 'mensual' } });
    vi.useRealTimers();
    estaExentoEnPeriodo.mockResolvedValue(false);

    expect(result.advertencias).toEqual([]);
    expect(result.registro.estadoPago).toBe('exento');
    expect(result.movimiento).toBeNull();
  });

  it('NO genera PASE_MENSUAL_IMPAGO dentro de la ventana de gracia del mes en curso', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-05T15:00:00.000Z')); // día 5 (ART) — dentro de la ventana
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ estado: 'pagada' }) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });

    const result = await registrarMuroLibre({ clubId: CLUB_ID, user: USER, body: { socioId: SOCIO_ID, tipoPase: 'mensual' } });
    vi.useRealTimers();

    expect(result.advertencias).toEqual([]);
  });

  it('suscribe automáticamente y crea la Cuota pagada cuando el socio paga el pase mensual sin estar suscripto', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    // Primera llamada: cuota social (impaga) — segunda: cuota mensual (no existe)
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });
    mockSuscripcionMensualQuery(null);

    const result = await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pagado', paymentMethod: 'Efectivo', fecha: '2026-06-15T00:00:00.000Z' },
    });

    expect(suscripcionSaveSpy).toHaveBeenCalledTimes(1);
    expect(savedSuscripciones[0]).toMatchObject({ clubId: CLUB_ID, fechaDesde: '2026-06', active: true });
    expect(String(savedSuscripciones[0].socioId)).toBe(String(SOCIO_ID));
    expect(String(savedSuscripciones[0].etiquetaId)).toBe(String(ETIQUETA_ID));
    expect(cuotaSaveSpy).toHaveBeenCalledTimes(1);
    expect(savedCuotas[0]).toMatchObject({
      clubId: CLUB_ID, periodo: '2026-06', estado: 'pagada', montoPagadoSnapshot: 8000, paymentMethod: 'Efectivo',
    });
    expect(String(savedCuotas[0].socioId)).toBe(String(SOCIO_ID));
    expect(String(savedCuotas[0].etiquetaId)).toBe(String(ETIQUETA_ID));
    expect(String(savedCuotas[0].suscripcionId)).toBe(String(savedSuscripciones[0]._id));
    expect(result.advertencias).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ codigo: 'PASE_MENSUAL_IMPAGO' }),
    ]));
  });

  it('pase mensual del último día del mes a las 23:30 ART: período de ese mes, no del siguiente (appcarc-backend#283)', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });
    // Sirve con y sin .sort() en la cadena (#282 lo agrega).
    const suscripcionQuery = { session: vi.fn().mockResolvedValue(null) };
    suscripcionQuery.sort = vi.fn().mockReturnValue(suscripcionQuery);
    Suscripcion.findOne = vi.fn().mockReturnValue(suscripcionQuery);

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      // = 2026-09-01T02:30Z
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pagado', paymentMethod: 'Efectivo', fecha: '2026-08-31T23:30:00-03:00' },
    });

    expect(savedRegistros[0].periodo).toBe('2026-08');
    expect(savedSuscripciones[0].fechaDesde).toBe('2026-08');
    expect(savedCuotas[0].periodo).toBe('2026-08');
  });

  it('no crea una nueva Suscripcion si ya estaba suscripto, solo la Cuota al pagar', async () => {
    const existingSuscripcionId = new mongoose.Types.ObjectId();
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });
    mockSuscripcionMensualQuery({ _id: existingSuscripcionId });

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pagado', paymentMethod: 'Efectivo', fecha: '2026-06-15T00:00:00.000Z' },
    });

    expect(suscripcionSaveSpy).not.toHaveBeenCalled();
    expect(cuotaSaveSpy).toHaveBeenCalledTimes(1);
    expect(String(savedCuotas[0].suscripcionId)).toBe(String(existingSuscripcionId));
  });

  it('busca la suscripción mensual solo entre las vigentes o programadas, prefiriendo la vigente (appcarc-backend#282)', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });
    mockSuscripcionMensualQuery(null);

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pendiente', fecha: '2026-08-15T15:00:00.000Z' },
    });

    expect(Suscripcion.findOne).toHaveBeenCalledWith(expect.objectContaining({
      clubId: CLUB_ID,
      active: true,
      $or: [{ fechaHasta: null }, { fechaHasta: { $gte: '2026-08' } }],
    }));
    expect(Suscripcion.findOne.mock.results[0].value.sort).toHaveBeenCalledWith({ fechaDesde: 1 });
  });

  it('un pase mensual programado a futuro no bloquea un check-in diario de hoy (filtra fechaDesde <= período del check-in)', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Stefano', apellido: 'Cossa', dni: '1', estado: 'Activo' });
    mockEtiquetaQuery({ _id: ETIQUETA_ID, uso_sistema: 'muro_libre_diario_socio' });
    mockPrecioVigenteQuery({ monto: 8000 });
    Cuota.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ estado: 'pagada' }) }) });
    Suscripcion.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'diario', estadoPago: 'pendiente', fecha: '2026-09-23T15:00:00.000Z' },
    });

    expect(Suscripcion.findOne).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      fechaDesde: { $lte: '2026-09' },
    }));
    expect(savedRegistros[0]).toMatchObject({ tipoPase: 'diario' });
  });

  it('si tenía el pase mensual programado para más adelante y hoy entra con pase mensual, se adelanta el inicio (no se duplica)', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Stefano', apellido: 'Cossa', dni: '1', estado: 'Activo' });
    mockPrecioVigenteQuery({ monto: 8000 });
    const futura = { _id: new mongoose.Types.ObjectId(), fechaDesde: '2026-10', save: vi.fn().mockResolvedValue(undefined) };
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ estado: 'pagada' }) }) })
      .mockReturnValueOnce({ session: vi.fn().mockResolvedValue(null) });
    mockSuscripcionMensualQuery(futura);

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pendiente', fecha: '2026-09-23T15:00:00.000Z' },
    });

    expect(futura.fechaDesde).toBe('2026-09');
    expect(futura.save).toHaveBeenCalledTimes(1);
    expect(suscripcionSaveSpy).not.toHaveBeenCalled();
  });

  it('falla con mensaje claro si no hay etiqueta de Muro Libre Mensual configurada', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    Etiqueta.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    await expect(registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pendiente' },
    })).rejects.toMatchObject({ message: 'No hay una etiqueta de Muro Libre Mensual configurada para este club' });

    expect(suscripcionSaveSpy).not.toHaveBeenCalled();
  });

  it('should register pendiente without movimiento and monto zero', async () => {
    mockPrecioVigenteQuery({ monto: 3000 });

    const result = await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', nombre: 'Luis', estadoPago: 'pendiente' },
    });

    expect(registroSaveSpy).toHaveBeenCalledTimes(1);
    expect(movimientoSaveSpy).not.toHaveBeenCalled();
    expect(savedRegistros[0]).toMatchObject({ estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago' });
    expect(result.movimiento).toBeNull();
  });

  it('should register exento without movimiento', async () => {
    mockPrecioVigenteQuery(null);

    const result = await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', nombre: 'Martina', estadoPago: 'exento' },
    });

    expect(registroSaveSpy).toHaveBeenCalledTimes(1);
    expect(movimientoSaveSpy).not.toHaveBeenCalled();
    expect(savedRegistros[0]).toMatchObject({ estadoPago: 'exento', monto: 0 });
  });

  it('should use noSocio uso_sistema when no socio is linked', async () => {
    mockEtiquetaQuery({ _id: ETIQUETA_ID, uso_sistema: 'muro_libre_diario_no_socio' });
    mockPrecioVigenteQuery(null);

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', nombre: 'Visitante', estadoPago: 'pendiente' },
    });

    expect(Etiqueta.findOne).toHaveBeenCalledWith(expect.objectContaining({
      uso_sistema: 'muro_libre_diario_no_socio',
    }));
  });

  it('filtra active:true en la consulta de cuota social y de cuota mensual', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery({ monto: 8000 });
    const cuotaSocialQuery = { session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) };
    const cuotaMensualQuery = { session: vi.fn().mockResolvedValue(null) };
    Cuota.findOne = vi.fn()
      .mockReturnValueOnce(cuotaSocialQuery)
      .mockReturnValueOnce(cuotaMensualQuery);

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'mensual', estadoPago: 'pendiente' },
    });

    expect(Cuota.findOne).toHaveBeenNthCalledWith(1, expect.objectContaining({ estado: 'pagada', active: true }));
    expect(Cuota.findOne).toHaveBeenNthCalledWith(2, expect.objectContaining({ estado: 'pagada', active: true }));
  });

  it('convierte un duplicate key error (11000) de diaCheckin en un 409 con el mismo mensaje del chequeo en memoria', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', dni: '12345678' });
    mockPrecioVigenteQuery(null);
    Suscripcion.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    Cuota.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    const dupError = new Error('E11000 duplicate key error collection: appcarc.asistencias index: clubId_1_socioId_1_tipo_1_diaCheckin_1_active_1 dup key: { diaCheckin: "2026-06-15" }');
    dupError.code = 11000;
    dupError.keyPattern = { clubId: 1, socioId: 1, tipo: 1, diaCheckin: 1, active: 1 };
    registroSaveSpy.mockRejectedValueOnce(dupError);

    await expect(registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { socioId: SOCIO_ID, tipoPase: 'diario', estadoPago: 'exento' },
    })).rejects.toMatchObject({ status: 409, message: 'Ana García ya registró asistencia en muro libre hoy' });
  });

  it('un socio dado de Baja cuenta como no socio: precio de no socio y esSocio false', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Roberto', apellido: 'Teodosio', dni: '34980157', estado: 'Baja' });
    Suscripcion.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    mockEtiquetaQuery({ _id: ETIQUETA_ID, uso_sistema: 'muro_libre_diario_no_socio' });
    mockPrecioVigenteQuery({ monto: 8000 });

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', socioId: SOCIO_ID, estadoPago: 'pendiente' },
    });

    expect(Etiqueta.findOne).toHaveBeenCalledWith(expect.objectContaining({ uso_sistema: 'muro_libre_diario_no_socio' }));
    expect(savedRegistros[0]).toMatchObject({ esSocio: false, precioSugeridoSnapshot: 8000 });
    // No se le reclama cuota social a alguien que ya no es socio.
    expect(Cuota.findOne).not.toHaveBeenCalled();
    expect(savedRegistros[0].advertencias ?? []).toHaveLength(0);
  });

  it('un socio Adherente sigue siendo socio (precio de socio)', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Alma', apellido: 'Teodosio', dni: '52464718', estado: 'Adherente' });
    Suscripcion.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    Cuota.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ estado: 'pagada' }) }) });
    mockEtiquetaQuery({ _id: ETIQUETA_ID, uso_sistema: 'muro_libre_diario_socio' });
    mockPrecioVigenteQuery({ monto: 4000 });

    await registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'diario', socioId: SOCIO_ID, estadoPago: 'pendiente' },
    });

    expect(Etiqueta.findOne).toHaveBeenCalledWith(expect.objectContaining({ uso_sistema: 'muro_libre_diario_socio' }));
    expect(savedRegistros[0]).toMatchObject({ esSocio: true });
  });

  it('un socio dado de Baja no puede sacar pase mensual', async () => {
    mockSocioQuery({ _id: SOCIO_ID, nombre: 'Roberto', apellido: 'Teodosio', dni: '34980157', estado: 'Baja' });

    await expect(registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'mensual', socioId: SOCIO_ID, estadoPago: 'pendiente' },
    })).rejects.toMatchObject({ message: 'El pase mensual solo está disponible para socios' });

    expect(registroSaveSpy).not.toHaveBeenCalled();
  });

  it('should fail when mensual is attempted without a linked socio', async () => {
    await expect(registrarMuroLibre({
      clubId: CLUB_ID, user: USER,
      body: { tipoPase: 'mensual', nombre: 'Visitante', esSocio: true, estadoPago: 'pendiente' },
    })).rejects.toMatchObject({ message: 'El pase mensual solo está disponible para socios' });

    expect(registroSaveSpy).not.toHaveBeenCalled();
  });
});

describe('anularCuotaMuroLibreMensual', () => {
  const SESSION = { fake: 'session' };

  afterEach(() => vi.restoreAllMocks());

  it('appcarc-backend#153: anula la Cuota que un check-in de pase mensual pagado generó, ubicándola por movimientoId', async () => {
    Cuota.updateMany = vi.fn().mockResolvedValue({ modifiedCount: 1 });
    const movimientoId = new mongoose.Types.ObjectId();

    await anularCuotaMuroLibreMensual({ clubId: CLUB_ID, movimientoId, actor: 'secretaria@carc.test', session: SESSION });

    expect(Cuota.updateMany).toHaveBeenCalledWith(
      { clubId: CLUB_ID, movimientoId },
      { estado: 'anulada', updatedBy: 'secretaria@carc.test' },
      { session: SESSION },
    );
  });

  it('no hace nada si no hay movimientoId (ej. pase diario, o mensual que nunca se pagó)', async () => {
    Cuota.updateMany = vi.fn();

    await anularCuotaMuroLibreMensual({ clubId: CLUB_ID, movimientoId: null, actor: 'secretaria@carc.test', session: SESSION });

    expect(Cuota.updateMany).not.toHaveBeenCalled();
  });
});
