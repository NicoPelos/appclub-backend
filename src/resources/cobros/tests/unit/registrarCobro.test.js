import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';

import { BusinessError, registrarCobro } from '../../services/registrarCobro.service.js';
import Socio from '../../../socios/models/Socio.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Precios from '../../../cuotas/models/Precios.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import Cobro from '../../models/Cobro.js';
import Movimiento from '../../../movimientos/models/Movimiento.js';
import CargoPuntual from '../../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';

const CLUB_ID = 'club1';
const SOCIO_ID = '507f1f77bcf86cd799439011';
const SUSCRIPCION_ID = '507f1f77bcf86cd799439099';
const ETIQUETA_ID = '507f1f77bcf86cd799439088';
const CARGO_PUNTUAL_ID = '507f1f77bcf86cd799439077';
const ASISTENCIA_ID_1 = '507f1f77bcf86cd799439066';
const ASISTENCIA_ID_2 = '507f1f77bcf86cd799439055';
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

const buildSessionQuery = (result) => ({ session: vi.fn().mockResolvedValue(result) });

const mockSuscripcionVigente = (result) => {
  Suscripcion.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) });
};

const mockCargoPuntualVigente = (result) => {
  CargoPuntual.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) });
};

const mockAsistenciasPendientes = (result) => {
  Asistencia.find = vi.fn().mockReturnValueOnce({
    sort: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(result) }),
  });
};

const mockAsistenciasDb = (result) => {
  Asistencia.find.mockReturnValueOnce({ session: vi.fn().mockResolvedValue(result) });
};

const mockEtiquetaMuroLibre = (result) => {
  Etiqueta.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });
};

const mockPrecioVigente = (result) => {
  // findPrecioVigente hace .sort().lean(), y .lean() devuelve algo awaiteable
  // directamente (sin session) o encadenable con .session(session) — replica
  // ambas formas.
  const leanQuery = Promise.resolve(result);
  leanQuery.session = vi.fn().mockResolvedValue(result);
  const sortQuery = { sort: vi.fn().mockReturnValue({ lean: vi.fn().mockReturnValue(leanQuery) }) };
  Precios.findOne = vi.fn().mockReturnValue(sortQuery);
  return { sortQuery, leanQuery };
};

const validItem = {
  socioId: SOCIO_ID,
  suscripcionId: SUSCRIPCION_ID,
  periodo: '2026-06',
  amount: 15000,
};

const validBody = {
  paymentMethod: 'Efectivo',
  items: [validItem],
};

describe('registrarCobro service (unit)', () => {
  let sessionMock;
  let cobroSaveSpy;
  let movimientoSaveSpy;
  let cuotaSaveSpy;
  let savedCobros;
  let savedMovimientos;
  let savedCuotas;

  beforeEach(() => {
    savedCobros = [];
    savedMovimientos = [];
    savedCuotas = [];

    sessionMock = {
      withTransaction: vi.fn(async (callback) => callback()),
      endSession: vi.fn(),
    };

    vi.spyOn(mongoose, 'startSession').mockResolvedValue(sessionMock);

    Socio.find = vi.fn();
    Cuota.find = vi.fn();
    Precios.findOne = vi.fn();
    Suscripcion.findOne = vi.fn();
    CargoPuntual.findOne = vi.fn();
    CargoPuntual.find = vi.fn();
    Asistencia.find = vi.fn();
    Etiqueta.findOne = vi.fn();

    cobroSaveSpy = vi.spyOn(Cobro.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedCobros.push(this);
      return this;
    });

    movimientoSaveSpy = vi.spyOn(Movimiento.prototype, 'save').mockImplementation(async function () {
      if (!this._id) this._id = new mongoose.Types.ObjectId();
      savedMovimientos.push(this);
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
    await expect(registrarCobro({ clubId: undefined, user: USER, body: {} }))
      .rejects.toMatchObject({ status: 401 });

    expect(mongoose.startSession).not.toHaveBeenCalled();
  });

  it('should throw BusinessError on invalid cobro date', async () => {
    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { date: 'no-date', paymentMethod: 'Efectivo', items: [] },
    })).rejects.toBeInstanceOf(BusinessError);

    expect(sessionMock.endSession).not.toHaveBeenCalled();
  });

  it('should throw BusinessError on future cobro date', async () => {
    const mañana = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { date: mañana, paymentMethod: 'Efectivo', items: [] },
    })).rejects.toEqual(expect.objectContaining({
      message: 'La fecha del cobro no puede ser futura',
    }));

    expect(sessionMock.endSession).not.toHaveBeenCalled();
  });

  it('should fail when no cuotas are sent', async () => {
    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { paymentMethod: 'Efectivo', items: [] },
    })).rejects.toEqual(expect.objectContaining({
      message: 'El cobro debe incluir al menos un ítem',
    }));

    expect(sessionMock.endSession).toHaveBeenCalledTimes(1);
  });

  it('should fail when item is missing socioId', async () => {
    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { paymentMethod: 'Efectivo', items: [{ ...validItem, socioId: '' }] },
    })).rejects.toEqual(expect.objectContaining({
      message: 'El item 1 debe indicar socioId',
    }));
  });

  it('should fail when item is missing suscripcionId, cargoPuntualId and muroLibrePendiente', async () => {
    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { paymentMethod: 'Efectivo', items: [{ ...validItem, suscripcionId: '' }] },
    })).rejects.toEqual(expect.objectContaining({
      message: 'El item 1 debe indicar suscripcionId, cargoPuntualId o muroLibrePendiente',
    }));
  });

  it('should fail when suscripcion not found', async () => {
    mockSuscripcionVigente(null);

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER, body: validBody,
    })).rejects.toMatchObject({ status: 404 });
  });

  it('should fail when there are duplicated expanded cuotas', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        items: [{
          socioId: SOCIO_ID,
          suscripcionId: SUSCRIPCION_ID,
          periodos: ['2026-06', '2026-06'],
          amount: 12000,
        }],
      },
    })).rejects.toEqual(expect.objectContaining({
      message: expect.stringContaining('cuota duplicada'),
    }));

    expect(Socio.find).not.toHaveBeenCalled();
  });

  it('should fail when payment method is invalid', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { paymentMethod: 'Tarjeta', items: [validItem] },
    })).rejects.toEqual(expect.objectContaining({
      message: 'La forma de pago debe ser Efectivo o Transferencia',
    }));

    expect(Socio.find).not.toHaveBeenCalled();
  });

  it('#317: sin importe ni precio vigente, nombra la cuota y el mes de la fecha del cobro y devuelve PRECIO_NO_VIGENTE', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    mockPrecioVigente(null);
    const select = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ETIQUETA_ID, nombre: 'Remeras' }) }) });
    Etiqueta.findOne = vi.fn().mockReturnValue({ select });

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        date: '2026-10-02T12:00:00.000Z',
        items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodo: '2026-12' }],
      },
    })).rejects.toMatchObject({
      status: 400,
      message: 'No hay precio vigente para «Remeras» en octubre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
      data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: ETIQUETA_ID, etiquetaNombre: 'Remeras', periodo: '2026-10' },
    });

    expect(Precios.findOne).toHaveBeenCalledTimes(1);
    expect(Etiqueta.findOne).toHaveBeenCalledWith({ _id: ETIQUETA_ID, clubId: CLUB_ID });
    expect(Socio.find).not.toHaveBeenCalled();
  });

  it('#317: si la etiqueta no aparece, igual devuelve PRECIO_NO_VIGENTE con el etiquetaId', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    mockPrecioVigente(null);
    Etiqueta.findOne = vi.fn().mockReturnValue({ select: () => ({ session: () => ({ lean: vi.fn().mockResolvedValue(null) }) }) });

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        date: '2026-10-02T12:00:00.000Z',
        items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodo: '2026-12' }],
      },
    })).rejects.toMatchObject({
      message: 'No hay precio vigente para esta cuota en octubre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
      data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: ETIQUETA_ID, etiquetaNombre: null },
    });
  });

  it('should fail with 404 when any socio is missing or inactive', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    Socio.find.mockReturnValue(buildSessionQuery([]));

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER, body: validBody,
    })).rejects.toMatchObject({
      status: 404,
      message: `El socio ${SOCIO_ID} no existe, está inactivo o pertenece a otro club`,
    });

    expect(Cuota.find).not.toHaveBeenCalled();
    expect(cobroSaveSpy).not.toHaveBeenCalled();
  });

  it('should fail with 409 when cuota already paid', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
    Cuota.find.mockReturnValue(buildSessionQuery([{
      socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodo: '2026-06', estado: 'pagada',
    }]));

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER, body: validBody,
    })).rejects.toMatchObject({ status: 409 });

    expect(cobroSaveSpy).not.toHaveBeenCalled();
  });

  it('should create cobro, movimiento and cuotas in one transaction', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    mockPrecioVigente({ monto: 15000 });
    Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
    Cuota.find.mockReturnValue(buildSessionQuery([]));

    const result = await registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        description: 'Cobro de prueba',
        items: [{
          socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID,
          periodoDesde: '2026-06', cantidad: 2,
        }],
      },
    });

    expect(sessionMock.withTransaction).toHaveBeenCalledTimes(1);
    expect(cobroSaveSpy).toHaveBeenCalledTimes(2);
    expect(movimientoSaveSpy).toHaveBeenCalledTimes(1);
    expect(cuotaSaveSpy).toHaveBeenCalledTimes(2);

    expect(savedMovimientos[0]).toMatchObject({
      type: 'Ingreso', paymentMethod: 'Efectivo', amount: 30000, sourceType: 'cobro',
    });

    expect(savedCuotas.map((c) => c.periodo)).toEqual(['2026-06', '2026-07']);
    expect(result.cuotas).toHaveLength(2);
  });

  it('should allow paying a future periodo within the 24-month advance cap (adelantar meses)', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
    Cuota.find.mockReturnValue(buildSessionQuery([]));

    const result = await registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        date: '2026-09-01',
        items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-12'], amount: 15000 }],
      },
    });

    expect(result.cuotas.map((c) => c.periodo)).toEqual(['2026-12']);
  });

  it('should reject a periodo farther than 24 months in the future', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
    Cuota.find.mockReturnValue(buildSessionQuery([]));

    await expect(registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        date: '2026-09-01',
        items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2029-01'], amount: 15000 }],
      },
    })).rejects.toMatchObject({ status: 400 });

    expect(cobroSaveSpy).not.toHaveBeenCalled();
  });

  // #283: el tope de adelanto se cuenta desde el mes de la fecha del cobro en
  // hora argentina. El 31/08 a las 23:30 hs ART (02:30 UTC del 01/09) el mes
  // es agosto, así que el tope es 2028-08 y no 2028-09.
  it('#283: el tope de 24 meses se cuenta desde el mes argentino de la fecha del cobro', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-01T12:00:00.000-03:00'));
    try {
      mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      Cuota.find.mockReturnValue(buildSessionQuery([]));
      const cobrar = (periodo) => registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: {
          paymentMethod: 'Efectivo',
          date: '2026-08-31T23:30:00-03:00',
          items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: [periodo], amount: 15000 }],
        },
      });

      await expect(cobrar('2028-09')).rejects.toMatchObject({ status: 400, message: expect.stringContaining('demasiado lejano') });
      const result = await cobrar('2028-08');
      expect(result.cuotas.map((c) => c.periodo)).toEqual(['2028-08']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('should split an explicit amount across periods instead of applying it to each one', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
    Cuota.find.mockReturnValue(buildSessionQuery([]));

    const result = await registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: {
        paymentMethod: 'Efectivo',
        items: [{
          socioId: SOCIO_ID,
          suscripcionId: SUSCRIPCION_ID,
          periodos: ['2026-06', '2026-07'],
          amount: 12000,
        }],
      },
    });

    expect(savedMovimientos[0]).toMatchObject({ amount: 12000 });
    expect(result.cuotas.map((c) => c.montoPagadoSnapshot)).toEqual([6000, 6000]);
  });

  it('should update existing pending cuota instead of creating a new one', async () => {
    mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
    Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

    const existingCuota = {
      _id: new mongoose.Types.ObjectId(),
      clubId: CLUB_ID, socioId: SOCIO_ID,
      suscripcionId: SUSCRIPCION_ID, periodo: '2026-06',
      estado: 'pendiente', active: true,
      save: vi.fn(async function () { return this; }),
    };
    Cuota.find.mockReturnValue(buildSessionQuery([existingCuota]));

    const result = await registrarCobro({
      clubId: CLUB_ID, user: USER,
      body: { paymentMethod: 'Transferencia', items: [validItem] },
    });

    expect(existingCuota.save).toHaveBeenCalledTimes(1);
    expect(cuotaSaveSpy).not.toHaveBeenCalled();
    expect(existingCuota.estado).toBe('pagada');
    expect(result.cuotas[0]).toBe(existingCuota);
  });

  describe('cargo puntual (item sin suscripcionId)', () => {
    const cargoPuntualItem = { socioId: SOCIO_ID, cargoPuntualId: CARGO_PUNTUAL_ID };

    it('should fail with 404 when cargo puntual not found', async () => {
      mockCargoPuntualVigente(null);

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [cargoPuntualItem] },
      })).rejects.toMatchObject({ status: 404 });
    });

    it('should fail with 409 when cargo puntual is not pendiente', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Viaje a Cerro Negro', estado: 'pagada', montoEsperadoSnapshot: 200000,
      });

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [cargoPuntualItem] },
      })).rejects.toMatchObject({ status: 409 });

      expect(Socio.find).not.toHaveBeenCalled();
    });

    it('should pay a cargo puntual without creating a Cuota', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Viaje a Cerro Negro', estado: 'pendiente', montoEsperadoSnapshot: 200000,
        precioSugeridoSnapshot: 200000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      const cargoDoc = {
        _id: CARGO_PUNTUAL_ID, estado: 'pendiente', montoEsperadoSnapshot: 200000, montoPagadoSnapshot: 0, pagos: [],
        save: vi.fn(async function () { return this; }),
      };
      CargoPuntual.find.mockReturnValue(buildSessionQuery([cargoDoc]));

      const result = await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [cargoPuntualItem] },
      });

      expect(Cuota.find).not.toHaveBeenCalled();
      expect(cuotaSaveSpy).not.toHaveBeenCalled();
      expect(cargoDoc.save).toHaveBeenCalledTimes(1);
      expect(cargoDoc.estado).toBe('pagada');
      expect(cargoDoc.montoPagadoSnapshot).toBe(200000);
      expect(cargoDoc.paymentMethod).toBe('Efectivo');
      expect(result.cuotas).toHaveLength(0);
      expect(result.cargosPuntuales).toEqual([cargoDoc]);
      expect(savedMovimientos[0]).toMatchObject({ type: 'Ingreso', amount: 200000 });
    });

    it('should mix a cuota item and a cargo puntual item in the same cobro', async () => {
      mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Viaje a Cerro Negro', estado: 'pendiente', montoEsperadoSnapshot: 200000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      Cuota.find.mockReturnValue(buildSessionQuery([]));

      const cargoDoc = {
        _id: CARGO_PUNTUAL_ID, estado: 'pendiente', montoEsperadoSnapshot: 200000, montoPagadoSnapshot: 0, pagos: [],
        save: vi.fn(async function () { return this; }),
      };
      CargoPuntual.find.mockReturnValue(buildSessionQuery([cargoDoc]));

      const result = await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [validItem, cargoPuntualItem] },
      });

      expect(result.cuotas).toHaveLength(1);
      expect(result.cargosPuntuales).toHaveLength(1);
      expect(savedMovimientos[0].amount).toBe(15000 + 200000);
    });

    it('appcarc-backend#168: sin esPagoParcial, cualquier monto cierra el cargo (ajuste de precio, comportamiento sin cambios)', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Remera', estado: 'pendiente', montoEsperadoSnapshot: 30000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      const cargoDoc = {
        _id: CARGO_PUNTUAL_ID, estado: 'pendiente', montoEsperadoSnapshot: 30000, montoPagadoSnapshot: 0, pagos: [],
        save: vi.fn(async function () { return this; }),
      };
      CargoPuntual.find.mockReturnValue(buildSessionQuery([cargoDoc]));

      // Con descuento — bien por debajo de lo esperado, sin el flag.
      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ ...cargoPuntualItem, amount: 20000 }] },
      });

      expect(cargoDoc.estado).toBe('pagada');
      expect(cargoDoc.montoPagadoSnapshot).toBe(20000);
      expect(cargoDoc.pagos).toHaveLength(1);
    });

    it('appcarc-backend#168: con esPagoParcial y el monto no alcanza lo esperado, queda parcial con saldo', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Remera', estado: 'pendiente', montoEsperadoSnapshot: 30000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      const cargoDoc = {
        _id: CARGO_PUNTUAL_ID, estado: 'pendiente', montoEsperadoSnapshot: 30000, montoPagadoSnapshot: 0, pagos: [],
        save: vi.fn(async function () { return this; }),
      };
      CargoPuntual.find.mockReturnValue(buildSessionQuery([cargoDoc]));

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ ...cargoPuntualItem, amount: 15000, esPagoParcial: true }] },
      });

      expect(cargoDoc.estado).toBe('parcial');
      expect(cargoDoc.montoPagadoSnapshot).toBe(15000);
      expect(cargoDoc.pagos).toHaveLength(1);
      expect(cargoDoc.pagos[0]).toMatchObject({ monto: 15000, paymentMethod: 'Efectivo' });
    });

    it('appcarc-backend#168: permite cobrar el saldo de un cargo parcial (segundo pago), y lo cierra si llega a lo esperado', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Remera', estado: 'parcial', montoEsperadoSnapshot: 30000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      const cargoDoc = {
        _id: CARGO_PUNTUAL_ID,
        estado: 'parcial',
        montoEsperadoSnapshot: 30000,
        montoPagadoSnapshot: 15000,
        pagos: [{ monto: 15000, fecha: new Date('2026-07-01'), paymentMethod: 'Efectivo', cobroId: 'cobro-vieja', movimientoId: 'mov-viejo' }],
        save: vi.fn(async function () { return this; }),
      };
      CargoPuntual.find.mockReturnValue(buildSessionQuery([cargoDoc]));

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Transferencia', items: [{ ...cargoPuntualItem, amount: 15000 }] },
      });

      expect(cargoDoc.estado).toBe('pagada');
      expect(cargoDoc.montoPagadoSnapshot).toBe(30000);
      expect(cargoDoc.pagos).toHaveLength(2);
    });

    it('appcarc-backend#168: rechaza cobrar un cargo ya cerrado (pagada/anulada), pero permite uno parcial', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Remera', estado: 'anulada', montoEsperadoSnapshot: 30000,
      });

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [cargoPuntualItem] },
      })).rejects.toMatchObject({ status: 409 });
    });
  });

  describe('muro libre pendiente (item con muroLibrePendiente)', () => {
    const muroLibreItem = { socioId: SOCIO_ID, muroLibrePendiente: true };

    it('should fail with 404 when socio has no visitas pendientes', async () => {
      mockAsistenciasPendientes([]);

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [muroLibreItem] },
      })).rejects.toMatchObject({ status: 404 });

      expect(Socio.find).not.toHaveBeenCalled();
    });

    it('should fail with 409 when the selected visita was already resolved before the transaction re-check', async () => {
      const fecha = new Date('2026-07-01T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      mockAsistenciasDb([
        { _id: ASISTENCIA_ID_1, fecha, socioId: SOCIO_ID, estadoPago: 'pagado' },
      ]);

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [muroLibreItem] },
      })).rejects.toMatchObject({ status: 409 });
    });

    it('should pay only the oldest N pending visitas when cantidad is less than the total pendientes', async () => {
      const fecha1 = new Date('2026-07-01T12:00:00Z');
      const fecha2 = new Date('2026-07-05T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha: fecha1, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
        { _id: ASISTENCIA_ID_2, fecha: fecha2, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      const asistenciaDoc = {
        _id: ASISTENCIA_ID_1, estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago',
        save: vi.fn(async function () { return this; }),
      };
      mockAsistenciasDb([asistenciaDoc]);

      const result = await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ ...muroLibreItem, cantidad: 1 }] },
      });

      expect(asistenciaDoc.save).toHaveBeenCalledTimes(1);
      expect(asistenciaDoc.estadoPago).toBe('pagado');
      expect(asistenciaDoc.monto).toBe(5000);
      expect(asistenciaDoc.formaPago).toBe('Efectivo');
      expect(asistenciaDoc.cobroId).toBeDefined();
      expect(asistenciaDoc.movimientoId).toBeDefined();
      expect(result.asistencias).toEqual([asistenciaDoc]);
      expect(result.cuotas).toHaveLength(0);
      expect(savedMovimientos[0]).toMatchObject({ type: 'Ingreso', amount: 5000 });
    });

    it('#317: una visita registrada sin precio toma el precio vigente en la fecha de la visita', async () => {
      const fecha = new Date('2026-12-03T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha, esSocio: true, precioSugeridoSnapshot: null, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID, nombre: 'Muro Libre diario socio' });
      mockPrecioVigente({ monto: 7000 });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      const asistenciaDoc = {
        _id: ASISTENCIA_ID_1, estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago',
        save: vi.fn(async function () { return this; }),
      };
      mockAsistenciasDb([asistenciaDoc]);

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [muroLibreItem] },
      });

      expect(Precios.findOne).toHaveBeenCalledWith(expect.objectContaining({
        clubId: CLUB_ID, etiquetaId: ETIQUETA_ID, vigenteDesde: { $lte: fecha },
      }));
      expect(asistenciaDoc.monto).toBe(7000);
    });

    it('#317: visita sin precio y sin precio vigente en su fecha → PRECIO_NO_VIGENTE con la etiqueta de Muro Libre', async () => {
      const fecha = new Date('2026-12-03T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha, esSocio: true, precioSugeridoSnapshot: null, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID, nombre: 'Muro Libre diario socio' });
      mockPrecioVigente(null);

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [muroLibreItem] },
      })).rejects.toMatchObject({
        status: 400,
        message: 'No hay precio vigente para «Muro Libre diario socio» en diciembre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
        data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: ETIQUETA_ID, etiquetaNombre: 'Muro Libre diario socio', periodo: '2026-12' },
      });
      expect(Socio.find).not.toHaveBeenCalled();
    });

    it('#317: un item por visita (como manda el pago online) deja a cada visita con su propio importe', async () => {
      const fecha1 = new Date('2026-07-01T12:00:00Z');
      const fecha2 = new Date('2026-07-05T12:00:00Z');
      const pendientes = [
        { _id: ASISTENCIA_ID_1, fecha: fecha1, esSocio: true, precioSugeridoSnapshot: 2000, estadoPago: 'pendiente' },
        { _id: ASISTENCIA_ID_2, fecha: fecha2, esSocio: true, precioSugeridoSnapshot: 2500, estadoPago: 'pendiente' },
      ];
      Asistencia.find = vi.fn()
        .mockReturnValueOnce({ sort: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(pendientes) }) })
        .mockReturnValueOnce({ sort: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(pendientes) }) });
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      const doc = (id) => ({
        _id: id, estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago',
        save: vi.fn(async function () { return this; }),
      });
      const doc1 = doc(ASISTENCIA_ID_1);
      const doc2 = doc(ASISTENCIA_ID_2);
      mockAsistenciasDb([doc1, doc2]);

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: {
          paymentMethod: 'Efectivo',
          items: [
            { ...muroLibreItem, asistenciaIds: [ASISTENCIA_ID_1], amount: 2000 },
            { ...muroLibreItem, asistenciaIds: [ASISTENCIA_ID_2], amount: 2500 },
          ],
        },
      });

      expect(doc1.monto).toBe(2000);
      expect(doc2.monto).toBe(2500);
      expect(savedMovimientos[0]).toMatchObject({ amount: 4500 });
    });

    it('should pay exactly the visitas selected via asistenciaIds, even if not the oldest', async () => {
      const fecha1 = new Date('2026-07-01T12:00:00Z');
      const fecha2 = new Date('2026-07-05T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha: fecha1, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
        { _id: ASISTENCIA_ID_2, fecha: fecha2, esSocio: true, precioSugeridoSnapshot: 6000, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      // Elige la MÁS NUEVA (asistencia 2), no la más vieja como haría "cantidad".
      const asistenciaDoc = {
        _id: ASISTENCIA_ID_2, estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago',
        save: vi.fn(async function () { return this; }),
      };
      mockAsistenciasDb([asistenciaDoc]);

      const result = await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ ...muroLibreItem, asistenciaIds: [ASISTENCIA_ID_2] }] },
      });

      expect(asistenciaDoc.estadoPago).toBe('pagado');
      expect(asistenciaDoc.monto).toBe(6000);
      expect(result.asistencias).toEqual([asistenciaDoc]);
    });

    it('#283: el período de la visita es el mes argentino de su fecha (31/08 23:30 hs ART → 2026-08)', async () => {
      const fecha = new Date('2026-08-31T23:30:00.000-03:00');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      mockAsistenciasDb([{
        _id: ASISTENCIA_ID_1, estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago',
        save: vi.fn(async function () { return this; }),
      }]);

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [muroLibreItem] },
      });

      expect(savedCobros[0].items[0].periodo).toBe('2026-08');
    });

    it('should fail with 404 when an asistenciaId is not among the pendientes', async () => {
      const fecha1 = new Date('2026-07-01T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha: fecha1, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
      ]);

      await expect(registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ ...muroLibreItem, asistenciaIds: [ASISTENCIA_ID_2] }] },
      })).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('concept del Movimiento según los items del carrito', () => {
    it('usa "Cobro de cuotas" cuando el carrito son solo cuotas', async () => {
      mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      Cuota.find.mockReturnValue(buildSessionQuery([]));

      await registrarCobro({ clubId: CLUB_ID, user: USER, body: validBody });

      expect(savedMovimientos[0].concept).toBe('Cobro de cuotas');
    });

    it('usa la descripción del cargo cuando el carrito es un único cargo puntual', async () => {
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Remera adulto', estado: 'pendiente', montoEsperadoSnapshot: 30000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      CargoPuntual.find.mockReturnValue(buildSessionQuery([{
        _id: CARGO_PUNTUAL_ID, estado: 'pendiente', montoEsperadoSnapshot: 30000, montoPagadoSnapshot: 0, pagos: [],
        save: vi.fn(async function () { return this; }),
      }]));

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ socioId: SOCIO_ID, cargoPuntualId: CARGO_PUNTUAL_ID }] },
      });

      expect(savedMovimientos[0].concept).toBe('Remera adulto');
    });

    it('usa "Muro libre diario" cuando el carrito son solo visitas de muro libre', async () => {
      const fecha = new Date('2026-07-01T12:00:00Z');
      mockAsistenciasPendientes([
        { _id: ASISTENCIA_ID_1, fecha, esSocio: true, precioSugeridoSnapshot: 5000, estadoPago: 'pendiente' },
      ]);
      mockEtiquetaMuroLibre({ _id: ETIQUETA_ID });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      mockAsistenciasDb([{
        _id: ASISTENCIA_ID_1, estadoPago: 'pendiente', monto: 0, formaPago: 'Sin pago',
        save: vi.fn(async function () { return this; }),
      }]);

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [{ socioId: SOCIO_ID, muroLibrePendiente: true }] },
      });

      expect(savedMovimientos[0].concept).toBe('Muro libre diario');
    });

    it('usa un label genérico cuando el carrito mezcla tipos de item distintos', async () => {
      mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
      mockCargoPuntualVigente({
        _id: CARGO_PUNTUAL_ID, etiquetaId: ETIQUETA_ID, periodo: '2026-07',
        description: 'Remera adulto', estado: 'pendiente', montoEsperadoSnapshot: 30000,
      });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      Cuota.find.mockReturnValue(buildSessionQuery([]));
      CargoPuntual.find.mockReturnValue(buildSessionQuery([{
        _id: CARGO_PUNTUAL_ID, estado: 'pendiente', montoEsperadoSnapshot: 30000, montoPagadoSnapshot: 0, pagos: [],
        save: vi.fn(async function () { return this; }),
      }]));

      await registrarCobro({
        clubId: CLUB_ID, user: USER,
        body: { paymentMethod: 'Efectivo', items: [validItem, { socioId: SOCIO_ID, cargoPuntualId: CARGO_PUNTUAL_ID }] },
      });

      expect(savedMovimientos[0].concept).toBe('Cobro combinado (2 ítems)');
    });
  });

  describe('precio de cada mes (modoPrecio historico, #285)', () => {
    const MOTIVO = 'Acuerdo de regularización con la comisión';

    // Precios.find(...).lean() con o sin .session().
    const mockPreciosHistoricos = (precios) => {
      const leanQuery = Promise.resolve(precios);
      leanQuery.session = vi.fn().mockResolvedValue(precios);
      Precios.find = vi.fn().mockReturnValue({ lean: vi.fn().mockReturnValue(leanQuery) });
      return { leanQuery };
    };

    const PRECIOS = [
      { monto: 15000, vigenteDesde: new Date('2026-09-01T00:00:00Z'), vigenteHasta: null },
      { monto: 12000, vigenteDesde: new Date('2026-07-01T00:00:00Z'), vigenteHasta: new Date('2026-08-31T00:00:00Z') },
      { monto: 10000, vigenteDesde: new Date('2026-01-01T00:00:00Z'), vigenteHasta: new Date('2026-06-30T00:00:00Z') },
    ];

    const itemHistorico = (extra = {}) => ({
      socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-06', '2026-07', '2026-09'], ...extra,
    });

    const prepararHappyPath = () => {
      mockSuscripcionVigente({ _id: SUSCRIPCION_ID, etiquetaId: ETIQUETA_ID });
      mockPrecioVigente({ monto: 15000 });
      const precios = mockPreciosHistoricos(PRECIOS);
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));
      Cuota.find.mockReturnValue(buildSessionQuery([]));
      return precios;
    };

    const registrar = (body, extra = {}) => registrarCobro({
      clubId: CLUB_ID, user: USER, body: { paymentMethod: 'Efectivo', ...body }, ...extra,
    });

    it('cobra cada mes a su precio, guarda el de hoy como sugerido y registra modo y motivo', async () => {
      const { leanQuery } = prepararHappyPath();

      const result = await registrar({ modoPrecio: 'historico', motivoPrecioHistorico: `  ${MOTIVO} `, items: [itemHistorico()] });

      expect(savedCobros[0].items.map((i) => [i.periodo, i.amount, i.precioSugeridoSnapshot])).toEqual([
        ['2026-06', 10000, 15000], ['2026-07', 12000, 15000], ['2026-09', 15000, 15000],
      ]);
      expect(savedCobros[0].totalAmount).toBe(37000);
      expect(savedCobros[0].modoPrecio).toBe('historico');
      expect(savedCobros[0].motivoPrecioHistorico).toBe(MOTIVO);
      expect(savedCobros[0].createdBy).toBe(USER.email);
      expect(savedMovimientos[0].amount).toBe(37000);
      expect(savedCuotas.map((c) => [c.montoEsperadoSnapshot, c.montoPagadoSnapshot])).toEqual([[15000, 10000], [15000, 12000], [15000, 15000]]);
      expect(result.cobro.modoPrecio).toBe('historico');

      // Una consulta para los tres meses, con clubId, dentro de la transacción.
      expect(Precios.find).toHaveBeenCalledTimes(1);
      expect(Precios.find).toHaveBeenCalledWith(expect.objectContaining({ clubId: CLUB_ID, etiquetaId: ETIQUETA_ID, active: true }));
      expect(leanQuery.session).toHaveBeenCalledWith(sessionMock);
    });

    it('ignora el precioSugeridoSnapshot que mande el cliente y usa el precio de hoy', async () => {
      prepararHappyPath();

      await registrar({ modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemHistorico({ precioSugeridoSnapshot: 1 })] });

      expect(savedCobros[0].items.every((i) => i.precioSugeridoSnapshot === 15000)).toBe(true);
    });

    it('sin modoPrecio (o con "actual") queda como antes: precio de hoy, modo actual y sin motivo', async () => {
      prepararHappyPath();

      await registrar({ modoPrecio: 'actual', motivoPrecioHistorico: MOTIVO, items: [itemHistorico()] });

      expect(savedCobros[0].totalAmount).toBe(45000);
      expect(savedCobros[0].modoPrecio).toBe('actual');
      expect(savedCobros[0].motivoPrecioHistorico).toBeNull();
      expect(Precios.find).not.toHaveBeenCalled();
    });

    it.each(['Historico', 'historico ', 'histórico', '', 0, true])('rechaza modoPrecio %j sin abrir transacción', async (modoPrecio) => {
      await expect(registrar({ modoPrecio, motivoPrecioHistorico: MOTIVO, items: [itemHistorico()] }))
        .rejects.toMatchObject({ status: 400, message: 'El modo de precio debe ser "actual" o "historico"' });
      expect(mongoose.startSession).not.toHaveBeenCalled();
    });

    it('modoPrecio null equivale a "actual"', async () => {
      prepararHappyPath();
      await registrar({ modoPrecio: null, items: [itemHistorico()] });
      expect(savedCobros[0].modoPrecio).toBe('actual');
    });

    it.each([undefined, null, '', '         ', 'a b c d e f g h i', 123456789012])('rechaza el motivo %j (mínimo 10 caracteres sin espacios)', async (motivoPrecioHistorico) => {
      await expect(registrar({ modoPrecio: 'historico', motivoPrecioHistorico, items: [itemHistorico()] }))
        .rejects.toMatchObject({ status: 400, message: 'Para cobrar a precio de cada mes hay que indicar el motivo (mínimo 10 caracteres)' });
      expect(mongoose.startSession).not.toHaveBeenCalled();
    });

    it('acepta un motivo de exactamente 10 caracteres sin contar espacios', async () => {
      prepararHappyPath();
      await registrar({ modoPrecio: 'historico', motivoPrecioHistorico: ' a b c d e f g h i j ', items: [itemHistorico()] });
      expect(savedCobros[0].motivoPrecioHistorico).toBe('a b c d e f g h i j');
    });

    it('rechaza amount en un item de suscripción', async () => {
      prepararHappyPath();
      await expect(registrar({ modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemHistorico({ amount: 30000 })] }))
        .rejects.toMatchObject({ status: 400, message: 'El item 1 no puede llevar importe: al cobrar a precio de cada mes, el importe lo calcula el sistema' });
      expect(cobroSaveSpy).not.toHaveBeenCalled();
    });

    it('bloquea si un mes no tiene precio, nombrando la cuota y el mes (PRECIO_NO_VIGENTE, #317)', async () => {
      prepararHappyPath();
      mockPreciosHistoricos([PRECIOS[0]]);
      const select = vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ nombre: 'Cuota Social' }) }) });
      Etiqueta.findOne = vi.fn().mockReturnValue({ select });

      await expect(registrar({ modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemHistorico({ periodos: ['2026-09', '2026-07'] })] }))
        .rejects.toMatchObject({
          status: 400,
          message: 'No hay precio vigente para «Cuota Social» en julio 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
          data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: ETIQUETA_ID, etiquetaNombre: 'Cuota Social', periodo: '2026-07' },
        });
      expect(Etiqueta.findOne).toHaveBeenCalledWith({ _id: ETIQUETA_ID, clubId: CLUB_ID });
      expect(select).toHaveBeenCalledWith('nombre');
      expect(cobroSaveSpy).not.toHaveBeenCalled();
    });

    it('si la etiqueta no aparece, el mensaje igual nombra el mes', async () => {
      prepararHappyPath();
      mockPreciosHistoricos([]);
      Etiqueta.findOne = vi.fn().mockReturnValue({ select: () => ({ session: () => ({ lean: vi.fn().mockResolvedValue(null) }) }) });

      await expect(registrar({ modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemHistorico({ periodos: ['2026-03'] })] }))
        .rejects.toMatchObject({ message: 'No hay precio vigente para esta cuota en marzo 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.' });
    });

    it('un precio de $0 en un mes no cuenta como "sin precio"', async () => {
      prepararHappyPath();
      mockPreciosHistoricos([{ monto: 0, vigenteDesde: new Date('2026-01-01'), vigenteHasta: null }]);

      await registrar({ modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemHistorico({ periodos: ['2026-05'] })] });

      expect(savedCobros[0].items[0].amount).toBe(0);
    });

    it('sin ningún item de suscripción, rechaza el modo histórico', async () => {
      mockCargoPuntualVigente({ _id: CARGO_PUNTUAL_ID, socioId: SOCIO_ID, etiquetaId: ETIQUETA_ID, estado: 'pendiente', montoEsperadoSnapshot: 8000, description: 'Remera', periodo: '2026-09' });
      Socio.find.mockReturnValue(buildSessionQuery([{ _id: SOCIO_ID }]));

      await expect(registrar({
        modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [{ socioId: SOCIO_ID, cargoPuntualId: CARGO_PUNTUAL_ID }],
      })).rejects.toMatchObject({ status: 400, message: 'El precio de cada mes solo se aplica a cuotas de suscripción, y este cobro no incluye ninguna' });
      expect(cobroSaveSpy).not.toHaveBeenCalled();
    });

    it('precioHistoricoHeredado (interno, de cambiarFormaPagoCobro) conserva modo y motivo con los importes tal cual', async () => {
      prepararHappyPath();

      await registrar(
        { items: [itemHistorico({ periodos: ['2026-06'], amount: 10000, precioSugeridoSnapshot: 15000 })] },
        { precioHistoricoHeredado: { motivo: MOTIVO } },
      );

      expect(savedCobros[0].modoPrecio).toBe('historico');
      expect(savedCobros[0].motivoPrecioHistorico).toBe(MOTIVO);
      expect(savedCobros[0].items[0]).toMatchObject({ amount: 10000, precioSugeridoSnapshot: 15000 });
      expect(Precios.find).not.toHaveBeenCalled();
    });

    it('busca el precio de hoy una sola vez por etiqueta aunque haya varios items', async () => {
      prepararHappyPath();

      await registrar({
        modoPrecio: 'historico',
        motivoPrecioHistorico: MOTIVO,
        items: [itemHistorico({ periodos: ['2026-06'] }), itemHistorico({ periodos: ['2026-07'] })],
      });

      expect(Precios.findOne).toHaveBeenCalledTimes(1);
      expect(savedCobros[0].items.map((i) => [i.amount, i.precioSugeridoSnapshot])).toEqual([[10000, 15000], [12000, 15000]]);
    });

    it('si hoy no hay precio vigente, cobra igual a precio de cada mes con precioSugeridoSnapshot null', async () => {
      prepararHappyPath();
      mockPrecioVigente(null);

      await registrar({ modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemHistorico({ periodos: ['2026-06'] })] });

      expect(savedCobros[0].items[0]).toMatchObject({ amount: 10000, precioSugeridoSnapshot: null });
      expect(savedCuotas[0]).toMatchObject({ montoEsperadoSnapshot: 10000, montoPagadoSnapshot: 10000 });
    });

    it('sin body falla por falta de items, no por leer modoPrecio de undefined', async () => {
      await expect(registrarCobro({ clubId: CLUB_ID, user: USER, body: undefined }))
        .rejects.toMatchObject({ status: 400, message: 'El cobro debe incluir al menos un ítem' });
    });

    it('precioHistoricoHeredado dentro del body no tiene efecto', async () => {
      prepararHappyPath();

      await registrar({ precioHistoricoHeredado: { motivo: MOTIVO }, items: [itemHistorico()] });

      expect(savedCobros[0].modoPrecio).toBe('actual');
      expect(savedCobros[0].totalAmount).toBe(45000);
    });
  });
});
