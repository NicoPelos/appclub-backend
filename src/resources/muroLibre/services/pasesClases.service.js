import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import { ARG_OFFSET_MS, periodoDeFecha } from '../../../services/fechaArgentina.js';

export const MOTIVO_EXENTO_PLAN_CLASES = 'plan_clases';

// Lunes 00:00 y domingo 23:59:59.999 de la semana de `fecha`, en hora argentina.
export const rangoSemanaArgentina = (fecha) => {
  const local = new Date(fecha.getTime() + ARG_OFFSET_MS);
  const diasDesdeLunes = (local.getUTCDay() + 6) % 7;
  const lunes = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - diasDesdeLunes) - ARG_OFFSET_MS;
  return { inicio: new Date(lunes), fin: new Date(lunes + 7 * 24 * 60 * 60 * 1000 - 1) };
};

// Pases de muro que la semana de `fecha` le da al socio por sus planes activos,
// y cuántos ya usó. Se toma el plan que más pases da (no se suman).
export const pasesIncluidosSemana = async ({ clubId, socioId, fecha, session }) => {
  const periodo = periodoDeFecha(fecha);
  const suscripciones = await Suscripcion.find({
    clubId,
    socioId,
    active: true,
    fechaDesde: { $lte: periodo },
    $or: [{ fechaHasta: null }, { fechaHasta: { $gte: periodo } }],
  }).populate('etiquetaId', 'pasesMuroPorSemana').session(session ?? null).lean();

  const { inicio, fin } = rangoSemanaArgentina(fecha);
  const proximaRenovacion = new Date(fin.getTime() + 1).toISOString();

  const max = suscripciones.reduce((mayor, s) => Math.max(mayor, s.etiquetaId?.pasesMuroPorSemana ?? 0), 0);
  if (max <= 0) return { max: 0, usados: 0, restantes: 0, proximaRenovacion };
  const usados = await Asistencia.countDocuments({
    clubId,
    socioId,
    tipo: 'muro_libre',
    tipoPase: 'diario',
    active: true,
    motivoExento: MOTIVO_EXENTO_PLAN_CLASES,
    fecha: { $gte: inicio, $lte: fin },
  }).session(session ?? null);

  return { max, usados, restantes: Math.max(0, max - usados), proximaRenovacion };
};
