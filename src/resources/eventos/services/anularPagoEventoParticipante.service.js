import EventoParticipante from '../models/EventoParticipante.js';

// Revierte el pago (identificado por su Movimiento) de un participante de
// evento — compartido entre el endpoint dedicado (DELETE .../pagos/:movimientoId,
// anularPagoEventoParticipante.handler.js) y deleteMovimiento.handler.js (si
// alguien borra el Movimiento directo desde la pantalla de Movimientos, sin
// pasar por la planilla del evento). Tenerla en un solo lugar es la lección
// de appcarc-backend#137: antes, anularCobro y deleteMovimiento tenían cada
// uno su copia parcial de esta misma lógica para CargoPuntual y quedaron
// desincronizadas (deleteMovimiento nunca llegó a revertir CargoPuntual).
//
// No borra el Movimiento en sí — eso lo decide el caller (distinto motivo de
// auditoría según de dónde se llame).
export const anularPagoEventoParticipante = async ({ clubId, movimientoId, actor, session }) => {
  const participante = await EventoParticipante.findOne({
    clubId, 'pagos.movimientoId': movimientoId, active: true,
  }).session(session);
  if (!participante) return null;

  participante.pagos = participante.pagos.filter((p) => String(p.movimientoId) !== String(movimientoId));
  participante.montoPagadoSnapshot = participante.pagos.reduce((sum, p) => sum + p.monto, 0);

  if (participante.pagos.length === 0) {
    participante.estado = 'pendiente';
  } else {
    participante.estado = participante.montoPagadoSnapshot >= participante.montoEsperadoSnapshot ? 'pagada' : 'parcial';
  }
  participante.updatedBy = actor;
  await participante.save({ session });

  return participante;
};

export default anularPagoEventoParticipante;
