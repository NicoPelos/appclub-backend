import Suscripcion from '../../suscripciones/models/Suscripcion.js';

// ¿El socio tiene, para esa etiqueta y ese período, un tramo de suscripción
// exento (plan "No genera deuda")? Los avisos de "sin cuota pagada" no deben
// dispararse para quien no debe pagar nada (ej. Staff, Colaboración).
export const estaExentoEnPeriodo = async ({ clubId, socioId, etiquetaId, periodo, session = null }) => {
  if (!etiquetaId || !socioId) return false;
  const query = Suscripcion.exists({
    clubId,
    socioId,
    etiquetaId,
    active: true,
    exento: true,
    fechaDesde: { $lte: periodo },
    $or: [{ fechaHasta: null }, { fechaHasta: { $gte: periodo } }],
  });
  return Boolean(await (session ? query.session(session) : query));
};
