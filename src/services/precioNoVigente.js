import { nombrePeriodo } from './fechaArgentina.js';

// Falta de precio vigente (appcarc-backend#317). Un solo mensaje para todos
// los caminos (cobro, cargo puntual, Muro Libre) y un código estable para que
// los clientes puedan mostrar su propio aviso con acceso a la pantalla de
// precios, sin depender del texto.
export const PRECIO_NO_VIGENTE = 'PRECIO_NO_VIGENTE';

export const mensajePrecioNoVigente = ({ etiquetaNombre, periodo }) => {
  const cuota = etiquetaNombre ? `«${etiquetaNombre}»` : 'esta cuota';
  const cuando = periodo ? ` en ${nombrePeriodo(periodo)}` : '';
  return `No hay precio vigente para ${cuota}${cuando}. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.`;
};

// Variante para el socio que paga online: no puede cargar precios ni escribir
// un monto, así que no se le indica la pantalla de precios.
export const mensajePrecioNoVigenteSocio = ({ etiquetaNombre, periodo }) => {
  const cuota = etiquetaNombre ? `«${etiquetaNombre}»` : 'esta cuota';
  const cuando = periodo ? ` para ${nombrePeriodo(periodo)}` : '';
  return `Todavía no está cargado el precio de ${cuota}${cuando}, así que por ahora no se puede pagar online. Le avisamos al club para que lo cargue.`;
};

// Campos extra que van en el cuerpo de la respuesta junto a `message`.
export const detallePrecioNoVigente = ({ etiqueta, periodo }) => ({
  code: PRECIO_NO_VIGENTE,
  etiquetaId: etiqueta?._id ? String(etiqueta._id) : null,
  etiquetaNombre: etiqueta?.nombre ?? null,
  periodo: periodo ?? null,
});
