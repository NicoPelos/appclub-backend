// Aplica un pago (total o a cuenta) sobre un documento que sigue el mismo
// "contrato de saldo": `pagos[]` (cada uno con monto/fecha/paymentMethod/
// movimientoId/esPagoParcial, +cobroId cuando corresponde), `montoPagadoSnapshot`
// (suma acumulada de `pagos`) y `estado` que pasa a 'parcial' o 'pagada' según
// el flag EXPLÍCITO `esPagoParcial` — nunca inferido comparando montos
// (appcarc-backend#168: cualquier monto arriba o abajo del esperado sigue
// siendo válido como ajuste de precio si no se manda el flag). Guardar
// `esPagoParcial` en el propio pago (no solo usarlo para decidir `estado`)
// deja el documento autocontenido — antes había que inferirlo de afuera para
// poder corregir/replayar un pago puntual (ver cambiarFormaPagoCobro.service.js).
//
// CargoPuntual y EventoParticipante comparten este contrato al pie de la
// letra (ver el comentario en EventoParticipante.js) — antes cada uno tenía
// su propia copia de este mismo algoritmo (dentro de registrarCobro.service.js
// y registrarPagoEventoParticipante.service.js respectivamente). Cada caller
// sigue siendo responsable de los campos que NO son parte de este contrato
// compartido (ej. los espejos `cargo.paymentMethod`/`cargo.fechaPago` que solo
// tiene CargoPuntual) y de guardar el documento.
export const aplicarPagoConSaldo = ({
  doc, monto, fecha, paymentMethod, movimientoId, cobroId = null, esPagoParcial, actor,
}) => {
  const pago = { monto, fecha, paymentMethod, movimientoId, esPagoParcial: Boolean(esPagoParcial) };
  if (cobroId) pago.cobroId = cobroId;
  doc.pagos.push(pago);

  doc.montoPagadoSnapshot = (doc.montoPagadoSnapshot || 0) + monto;
  const quedaSaldo = Boolean(esPagoParcial) && doc.montoPagadoSnapshot < doc.montoEsperadoSnapshot;
  doc.estado = quedaSaldo ? 'parcial' : 'pagada';
  doc.updatedBy = actor;

  return doc;
};

export default aplicarPagoConSaldo;
