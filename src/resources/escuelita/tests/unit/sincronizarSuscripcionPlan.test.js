import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import Plan from '../../../planes/models/Plan.js';
import Escuelita from '../../models/Escuelita.js';
import { logAudit } from '../../../audit/services/audit.service.js';
import { periodoDeFecha } from '../../../../services/fechaArgentina.js';
import { sincronizarSuscripcionEscuelita, sincronizarEscuelitaPorSuscripcionModificada } from '../../services/sincronizarSuscripcionPlan.service.js';

vi.mock('../../../audit/services/audit.service.js', () => ({
  logAudit: vi.fn(),
}));

const CLUB_ID = 'club1';
const SOCIO_ID = 'socio1';
const req = { user: { email: 'admin@carc.test', id: 'user1' } };
const session = {};

// findOne(...).session(...)
const chainableFindOne = (result) => ({ session: vi.fn().mockResolvedValue(result) });
// find(...).select(...).session(...).lean()
const chainablePlanFind = (result = []) => ({
  select: vi.fn().mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) }),
});

describe('sincronizarSuscripcionEscuelita', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Plan.find = vi.fn().mockReturnValue(chainablePlanFind([]));
  });
  afterEach(() => vi.restoreAllMocks());

  it('sin planId y sin suscripciones activas de escuelita: no hace nada', async () => {
    Plan.findOne = vi.fn();
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }) });
    Suscripcion.findOne = vi.fn();

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: null, req, session });

    expect(Plan.findOne).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it('sin planId (desasignar): cierra la suscripción de escuelita activa', async () => {
    const vieja = { _id: 's1', etiquetaId: 'etq-avanzados', planId: { _id: 'planA', tipo: 'escuelita' }, fechaHasta: null, toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined) };
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([vieja]) }) });
    Plan.findOne = vi.fn();

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: null, req, session });

    expect(vieja.fechaHasta).toMatch(/^\d{4}-\d{2}$/);
    expect(vieja.save).toHaveBeenCalledWith({ session });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'Suscripcion', action: 'UPDATE', resourceId: 's1' }));
  });

  it('el último día del mes a las 23:30 ART, desasignar cierra en el mes anterior al de Argentina (appcarc-backend#283)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-08-31T23:30:00-03:00')); // = 2026-09-01T02:30Z
    try {
      const vieja = { _id: 's1', etiquetaId: 'etq-avanzados', planId: { _id: 'planA', tipo: 'escuelita' }, fechaHasta: null, toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined) };
      Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([vieja]) }) });
      Plan.findOne = vi.fn();

      await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: null, req, session });

      // En Argentina sigue siendo agosto: cierra en julio, no en agosto como con UTC.
      expect(vieja.fechaHasta).toBe('2026-07');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lanza 400 si el plan no existe / no es de tipo escuelita', async () => {
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne(null));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }) });

    await expect(sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planX', req, session }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('crea una nueva Suscripcion si no había ninguna activa de escuelita', async () => {
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: 'planA', etiquetaId: 'etq-avanzados', tipo: 'escuelita' }));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }) });
    Suscripcion.findOne = vi.fn().mockReturnValue(chainableFindOne(null));

    const saveSpy = vi.spyOn(Suscripcion.prototype, 'save').mockResolvedValue(undefined);

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planA', req, session });

    expect(saveSpy).toHaveBeenCalledWith({ session });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'Suscripcion', action: 'CREATE' }));
  });

  it('ya sincronizada con la etiqueta correcta pero otro planId: solo actualiza planId (no crea ni cierra nada)', async () => {
    const actual = {
      _id: 's1', etiquetaId: 'etq-avanzados', planId: { _id: 'planViejo', tipo: 'escuelita' }, fechaHasta: null,
      toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined),
    };
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: 'planNuevo', etiquetaId: 'etq-avanzados', tipo: 'escuelita' }));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([actual]) }) });

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planNuevo', req, session });

    expect(actual.planId).toBe('planNuevo');
    expect(actual.save).toHaveBeenCalledWith({ session });
    expect(logAudit).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'Suscripcion', action: 'UPDATE', resourceId: 's1' }));
  });

  it('cambia de plan con otra etiqueta: cierra la vieja y crea la nueva', async () => {
    const vieja = {
      _id: 's-vieja', etiquetaId: 'etq-juveniles', planId: { _id: 'planJuveniles', tipo: 'escuelita' }, fechaHasta: null,
      toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined),
    };
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: 'planAvanzados', etiquetaId: 'etq-avanzados', tipo: 'escuelita' }));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([vieja]) }) });
    Suscripcion.findOne = vi.fn().mockReturnValue(chainableFindOne(null));
    const saveSpy = vi.spyOn(Suscripcion.prototype, 'save').mockResolvedValue(undefined);

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planAvanzados', req, session });

    expect(vieja.fechaHasta).toMatch(/^\d{4}-\d{2}$/);
    expect(vieja.save).toHaveBeenCalledWith({ session });
    expect(saveSpy).toHaveBeenCalledWith({ session });
    expect(logAudit).toHaveBeenCalledTimes(2);
  });

  it('reasignar el plan dos veces en el mismo período: desactiva la suscripción errónea en vez de dejarle fechaHasta anterior a fechaDesde', async () => {
    const periodoActual = periodoDeFecha(new Date());

    const elegidaPorError = {
      _id: 's-error', etiquetaId: 'etq-x1', planId: { _id: 'planX1', tipo: 'escuelita' },
      fechaDesde: periodoActual, fechaHasta: null, active: true,
      toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined),
    };
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: 'planX2', etiquetaId: 'etq-x2', tipo: 'escuelita' }));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([elegidaPorError]) }) });
    Suscripcion.findOne = vi.fn().mockReturnValue(chainableFindOne(null));
    const saveSpy = vi.spyOn(Suscripcion.prototype, 'save').mockResolvedValue(undefined);

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planX2', req, session });

    expect(elegidaPorError.active).toBe(false);
    expect(elegidaPorError.fechaHasta).toBeNull(); // nunca se toca fechaHasta, evitando el rango invertido
    expect(elegidaPorError.save).toHaveBeenCalledWith({ session });
    expect(saveSpy).toHaveBeenCalledWith({ session }); // la nueva Suscripcion (planX2) se crea normalmente
  });

  it('cierra la suscripción vieja de escuelita aunque no tenga planId, si su etiqueta es de un Plan de escuelita vigente (appcarc-backend#31)', async () => {
    // Reproduce el mismo patrón que Carreras en Cuota Social: la suscripción
    // vieja se migró/creó por script, sin Plan asociado.
    const viejaSinPlan = {
      _id: 's-vieja-sin-plan', etiquetaId: 'etq-x1', planId: null, fechaHasta: null,
      toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined),
    };
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: 'planX2', etiquetaId: 'etq-x2', tipo: 'escuelita' }));
    Plan.find = vi.fn().mockReturnValue(chainablePlanFind([{ etiquetaId: 'etq-x1' }, { etiquetaId: 'etq-x2' }]));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([viejaSinPlan]) }) });
    Suscripcion.findOne = vi.fn().mockReturnValue(chainableFindOne(null));
    const saveSpy = vi.spyOn(Suscripcion.prototype, 'save').mockResolvedValue(undefined);

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planX2', req, session });

    expect(viejaSinPlan.fechaHasta).toMatch(/^\d{4}-\d{2}$/);
    expect(viejaSinPlan.save).toHaveBeenCalledWith({ session });
    expect(saveSpy).toHaveBeenCalledWith({ session });
  });

  it('reactiva una Suscripcion inactiva existente en vez de chocar contra el índice único', async () => {
    const inactiva = {
      _id: 's-inactiva', active: false, planId: 'planViejo', fechaHasta: '2026-05',
      toObject: () => ({}), save: vi.fn().mockResolvedValue(undefined),
    };
    Plan.findOne = vi.fn().mockReturnValue(chainableFindOne({ _id: 'planA', etiquetaId: 'etq-avanzados', tipo: 'escuelita' }));
    Suscripcion.find = vi.fn().mockReturnValue({ populate: vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue([]) }) });
    Suscripcion.findOne = vi.fn().mockReturnValue(chainableFindOne(inactiva));

    await sincronizarSuscripcionEscuelita({ clubId: CLUB_ID, socioId: SOCIO_ID, planId: 'planA', req, session });

    expect(inactiva.active).toBe(true);
    expect(inactiva.fechaHasta).toBeNull();
    expect(inactiva.planId).toBe('planA');
    expect(inactiva.save).toHaveBeenCalledWith({ session });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'Suscripcion', action: 'UPDATE', resourceId: 's-inactiva' }));
  });
});

describe('sincronizarEscuelitaPorSuscripcionModificada (appcarc-backend#62)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Plan.find = vi.fn().mockReturnValue(chainablePlanFind([{ etiquetaId: 'etq-escuelita' }]));
  });
  afterEach(() => vi.restoreAllMocks());

  it('no hace nada si la etiqueta modificada no es de un plan de escuelita', async () => {
    Suscripcion.exists = vi.fn();
    Escuelita.findOne = vi.fn();

    await sincronizarEscuelitaPorSuscripcionModificada({ clubId: CLUB_ID, socioId: SOCIO_ID, etiquetaId: 'etq-otra-cosa', req, session });

    expect(Suscripcion.exists).not.toHaveBeenCalled();
    expect(Escuelita.findOne).not.toHaveBeenCalled();
  });

  it('no toca la ficha si el socio todavía tiene otra suscripción de escuelita vigente este mes', async () => {
    Suscripcion.exists = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue({ _id: 'otra-sus' }) });
    Escuelita.findOne = vi.fn();

    await sincronizarEscuelitaPorSuscripcionModificada({ clubId: CLUB_ID, socioId: SOCIO_ID, etiquetaId: 'etq-escuelita', req, session });

    expect(Escuelita.findOne).not.toHaveBeenCalled();
  });

  it('borra (soft-delete) la ficha de escuelita si no queda ninguna suscripción vigente este mes', async () => {
    Suscripcion.exists = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    const alumno = { _id: 'alumno1', active: true, toObject: () => ({ active: true }), save: vi.fn().mockResolvedValue(undefined) };
    Escuelita.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(alumno) });

    await sincronizarEscuelitaPorSuscripcionModificada({ clubId: CLUB_ID, socioId: SOCIO_ID, etiquetaId: 'etq-escuelita', req, session });

    expect(alumno.active).toBe(false);
    expect(alumno.save).toHaveBeenCalledWith({ session });
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ resource: 'Escuelita', action: 'UPDATE', resourceId: 'alumno1' }));
  });

  it('no hace nada si el socio no tiene ficha de escuelita (nunca fue alumno)', async () => {
    Suscripcion.exists = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    Escuelita.findOne = vi.fn().mockReturnValue({ session: vi.fn().mockResolvedValue(null) });

    await expect(sincronizarEscuelitaPorSuscripcionModificada({ clubId: CLUB_ID, socioId: SOCIO_ID, etiquetaId: 'etq-escuelita', req, session }))
      .resolves.not.toThrow();
    expect(logAudit).not.toHaveBeenCalled();
  });
});
