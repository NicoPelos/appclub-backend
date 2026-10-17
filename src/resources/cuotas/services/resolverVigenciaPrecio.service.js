import Precios from '../models/Precios.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';

class BusinessError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
  }
}

// Caso resoluble (hay un precio anterior abierto que se puede cerrar), pero
// no se resuelve solo sin que la persona lo confirme — a diferencia de
// BusinessError, esto no es un error de datos inválidos, es una pregunta.
class RequiereConfirmacionError extends Error {
  constructor(message, precios) {
    super(message);
    this.name = 'RequiereConfirmacionError';
    this.status = 409;
    this.precios = precios;
  }
}

export { BusinessError, RequiereConfirmacionError };

const formatFechaAR = (d) => new Date(d).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' });
const diaAnterior = (fecha) => new Date(fecha.getTime() - 24 * 60 * 60 * 1000);

/**
 * Resuelve la vigencia de un precio nuevo/editado contra los demás activos
 * de la misma etiqueta, para que nunca queden dos "vigentes" superpuestos
 * de forma ambigua.
 *
 * - Si hay uno que arrancó ANTES y sigue abierto sobre la fecha del nuevo
 *   (caso normal: "cargo el precio de agosto sin tocar el que ya rige"),
 *   NO lo cierra solo — tira RequiereConfirmacionError con el detalle, para
 *   que el cliente le pregunte a la persona ("¿cerramos el precio vigente
 *   el día antes de que arranque este?") y reintente con `confirmado: true`
 *   si dice que sí.
 * - Si hay uno con la MISMA fecha de inicio, o uno que arranca DESPUÉS y el
 *   nuevo se metería encima suyo, es ambiguo de una forma que no se resuelve
 *   ni preguntando "¿cerramos?" — se rechaza con BusinessError para que la
 *   persona ajuste las fechas a mano.
 * - Lo mismo si el anterior a cerrar sigue después de que termina el nuevo:
 *   cerrarlo dejaría esos meses sin ningún precio (#263, D5).
 * - `hasta` anterior a `desde` es un dato inválido (400).
 *
 * `session` es opcional — si se pasa, tanto la lectura como los cierres
 * confirmados participan de la misma transacción que el save() del llamador.
 */
export const resolverVigenciaPrecio = async ({ clubId, etiquetaId, desde, hasta, excludeId, confirmado, session }) => {
  if (hasta && hasta.getTime() < desde.getTime()) {
    throw new BusinessError('La fecha de fin no puede ser anterior a la de inicio.', 400);
  }

  // Secuencial, no Promise.all: dos operaciones en simultáneo sobre la misma
  // sesión de transacción rompen con "ConflictingOperationInProgress" — Mongo
  // no permite más de una operación en vuelo a la vez por sesión.
  const otros = await Precios.find({
    clubId,
    etiquetaId,
    active: true,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  }).session(session ?? null);
  const etiqueta = await Etiqueta.findById(etiquetaId).session(session ?? null).lean();
  const nombreEtiqueta = etiqueta?.nombre ?? 'esta etiqueta';

  const empate = otros.find((p) => p.vigenteDesde.getTime() === desde.getTime());
  if (empate) {
    throw new BusinessError(
      `Ya existe un precio de "${nombreEtiqueta}" que también arranca el ${formatFechaAR(desde)}. Elegí otra fecha de inicio.`,
    );
  }

  const posterior = otros.find((p) => {
    if (p.vigenteDesde.getTime() <= desde.getTime()) return false;
    return !hasta || hasta.getTime() >= p.vigenteDesde.getTime();
  });
  if (posterior) {
    throw new BusinessError(
      `Ya existe un precio de "${nombreEtiqueta}" programado para empezar el ${formatFechaAR(posterior.vigenteDesde)}, antes de que termine el que estás por guardar. Ajustá las fechas para que no se superpongan.`,
    );
  }

  const aCerrar = otros.filter((p) => {
    if (p.vigenteDesde.getTime() >= desde.getTime()) return false;
    return !p.vigenteHasta || p.vigenteHasta.getTime() >= desde.getTime();
  });

  if (aCerrar.length === 0) return;

  const sigueDespues = hasta && aCerrar.find((p) => !p.vigenteHasta || p.vigenteHasta.getTime() > hasta.getTime());
  if (sigueDespues) {
    throw new BusinessError(
      `El precio vigente de "${nombreEtiqueta}" sigue después del ${formatFechaAR(hasta)}: si lo cerramos para que arranque este, esos meses quedarían sin precio. Cargá también el precio que rige después, o dejá este sin fecha de fin.`,
    );
  }

  if (!confirmado) {
    throw new RequiereConfirmacionError(
      `Ya hay un precio vigente de "${nombreEtiqueta}" que no termina antes del ${formatFechaAR(desde)}. ¿Lo cerramos el ${formatFechaAR(diaAnterior(desde))} para que arranque este?`,
      aCerrar.map((p) => ({ id: String(p._id), cierrePropuesto: diaAnterior(desde) })),
    );
  }

  for (const previo of aCerrar) {
    previo.vigenteHasta = diaAnterior(desde);
    await previo.save({ session });
  }
};
