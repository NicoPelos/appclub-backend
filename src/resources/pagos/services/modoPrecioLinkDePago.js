// El link de Mercado Pago cobra siempre al precio de hoy: el importe se fija al
// crear la preferencia y el cobro lo registra el webhook, sin permiso ni motivo
// de quien lo armó. Cobrar a precio de cada mes (#285) solo se puede desde
// POST /api/cobros. Ausente (undefined o null, igual que en registrarCobro) o
// 'actual' pasa; cualquier otro valor, incluido 'Historico ', se rechaza en vez
// de ignorarse en silencio.
export const MENSAJE_LINK_SOLO_PRECIO_ACTUAL = 'El link de pago siempre cobra al precio actual. Para cobrar a precio de cada mes, registrá el cobro como efectivo o transferencia.';

export const linkDePagoAdmiteModoPrecio = (body) => body?.modoPrecio == null || body.modoPrecio === 'actual';
