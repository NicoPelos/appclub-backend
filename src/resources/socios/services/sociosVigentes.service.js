// Estados de socio que siguen generando cuota: un socio en Baja no genera
// deuda nueva, así que no entra en reportes de morosidad ni en avisos de
// cuotas (appcarc-backend#307).
//
// La comparación es exacta (case-sensitive), igual que siempre: un socio
// cargado a mano con estado 'activo' en minúscula, o sin estado, queda
// afuera. Si eso cambia, cambia para todos los que usan este filtro.
export const ESTADOS_VIGENTES = ['Activo', 'Adherente'];

// Filtro de Mongo para los socios vigentes de un club.
export const filtroSociosVigentes = (clubId) => ({
  clubId,
  active: true,
  estado: { $in: ESTADOS_VIGENTES },
});
