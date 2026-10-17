import Precios from '../models/Precios.js';
import { inicioDePeriodoArgentino } from '../../../services/fechaArgentina.js';

/**
 * Precio vigente de una etiqueta en varias fechas, con UNA sola consulta
 * (appcarc-backend#285): cobrar a precio de cada mes puede abarcar hasta 600
 * períodos, y una consulta por mes no escala. Trae los precios activos que se
 * cruzan con el rango [fecha mínima, fecha máxima] y elige en memoria con la
 * misma regla que findPrecioVigente: vigenteDesde <= fecha y (vigenteHasta
 * null o >= fecha), gana el de vigenteDesde más reciente. Se elige el más
 * reciente acá y no con un .sort de la query, así no depende del orden en que
 * vengan. La paridad con findPrecioVigente la fija
 * resolverPreciosPorPeriodo.integration.test.js.
 *
 * Devuelve un array alineado con `fechas`: el Precios (lean) o null.
 */
export const buscarPreciosVigentes = async ({ clubId, etiquetaId, fechas, session = null }) => {
  if (!fechas.length) return [];

  const tiempos = fechas.map((f) => f.getTime());
  const desde = new Date(Math.min(...tiempos));
  const hasta = new Date(Math.max(...tiempos));

  const query = Precios.find({
    clubId,
    etiquetaId,
    active: true,
    vigenteDesde: { $lte: hasta },
    $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: desde } }],
  }).lean();
  const precios = await (session ? query.session(session) : query);

  return fechas.map((fecha) => precios
    .filter((p) => p.vigenteDesde <= fecha && (p.vigenteHasta == null || p.vigenteHasta >= fecha))
    .reduce((masReciente, p) => (masReciente && masReciente.vigenteDesde >= p.vigenteDesde ? masReciente : p), null));
};

/**
 * Monto que regía en cada período 'YYYY-MM', tomando como referencia el 1° del
 * mes a las 00:00 hora argentina. Devuelve un Map periodo → monto, o null si
 * ese mes no tiene precio cargado (no se adivina uno).
 */
export const resolverPreciosPorPeriodo = async ({ clubId, etiquetaId, periodos, session = null }) => {
  const precios = await buscarPreciosVigentes({
    clubId, etiquetaId, fechas: periodos.map(inicioDePeriodoArgentino), session,
  });
  return new Map(periodos.map((periodo, i) => [periodo, precios[i]?.monto ?? null]));
};
