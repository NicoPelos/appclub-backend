import Precios from '../models/Precios.js';

/**
 * Busca el precio vigente de una etiqueta para una fecha dada. Compartido
 * por registrarCobro, crearCargoPuntual, calcularDeuda y getEtiquetas (para
 * mostrarlo como sugerencia) — antes estaba duplicado en cada uno.
 */
export const findPrecioVigente = async ({ clubId, etiquetaId, date, session = null }) => {
  const query = Precios.findOne({
    clubId,
    etiquetaId,
    active: true,
    vigenteDesde: { $lte: date },
    $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: date } }],
  }).sort({ vigenteDesde: -1 }).lean();

  return session ? query.session(session) : query;
};
