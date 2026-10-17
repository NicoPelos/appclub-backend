import mongoose from 'mongoose';
import Movimiento from '../../movimientos/models/Movimiento.js';
import EventoParticipante from '../models/EventoParticipante.js';
import { anularPagoEventoParticipante } from './anularPagoEventoParticipante.service.js';
import { registrarPagoEventoParticipante, BusinessError } from './registrarPagoEventoParticipante.service.js';

const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];

// Mismo mecanismo que cambiarFormaPagoCobro.service.js (backend de Cobros)
// pero para un pago puntual de un participante de Evento: anula ese pago
// (identificado por su Movimiento, no todo el historial del participante —
// puede haber más de uno, seña + saldo) y lo vuelve a registrar con la forma
// de pago corregida. Mismo monto y mismo esPagoParcial, que ahora vive en el
// propio `pago` (ver pagoConSaldo.service.js) — antes solo se usaba en
// memoria al registrar y se perdía, sin forma de replayarlo con certeza.
export const cambiarFormaPagoEventoParticipante = async ({
  clubId, user, eventoId, participanteId, movimientoId, paymentMethod,
}) => {
  if (!clubId) throw new BusinessError('No se pudo determinar el club del usuario', 401);
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new BusinessError('La forma de pago debe ser Efectivo o Transferencia');
  }

  const movimientoPrevio = await Movimiento.findOne({ _id: movimientoId, clubId, active: true }).lean();
  if (!movimientoPrevio) throw new BusinessError('Movimiento no encontrado', 404);
  if (movimientoPrevio.sourceType !== 'evento_participante') {
    throw new BusinessError('Este movimiento no corresponde a un pago de evento');
  }
  if (movimientoPrevio.paymentMethod === paymentMethod) {
    throw new BusinessError(`El pago ya está registrado como ${paymentMethod}`);
  }
  if (movimientoPrevio.mercadopagoVinculos?.length > 0) {
    throw new BusinessError('Este movimiento tiene pagos de Mercado Pago vinculados — desvinculalos primero.');
  }

  const participante = await EventoParticipante.findOne({
    _id: participanteId, eventoId, clubId, active: true,
  }).lean();
  if (!participante) throw new BusinessError('Participante no encontrado', 404);

  const pago = participante.pagos.find((p) => String(p.movimientoId) === String(movimientoId));
  if (!pago) throw new BusinessError('Ese pago no pertenece a este participante', 404);

  const actor = user?.email || user?.id;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Movimiento.findByIdAndUpdate(movimientoId, { active: false, updatedBy: actor }, { session });
      await anularPagoEventoParticipante({ clubId, movimientoId, actor, session });
    });
  } finally {
    session.endSession();
  }

  return registrarPagoEventoParticipante({
    clubId,
    user,
    eventoId,
    participanteId,
    monto: pago.monto,
    paymentMethod,
    esPagoParcial: Boolean(pago.esPagoParcial),
    date: movimientoPrevio.date,
  });
};

export { BusinessError };
export default cambiarFormaPagoEventoParticipante;
