import mongoose from 'mongoose';
import Cobro from '../models/Cobro.js';
import Movimiento from '../../movimientos/models/Movimiento.js';
import { anularCobroConTrazabilidad } from './anularCobro.service.js';
import { registrarCobro, BusinessError } from './registrarCobro.service.js';

const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];

// Único camino para corregir la forma de pago de un Cobro ya registrado — el
// Movimiento no se puede editar directo (updateMovimiento.handler.js lo
// bloquea a propósito, desincronizaría de la Cuota real que ya quedó con el
// medio de pago viejo). Automatiza lo que hasta ahora había que hacer a mano
// en dos pasos (anular el cobro + volver a cargarlo desde Registrar Cobro),
// reusando anularCobroConTrazabilidad y registrarCobro tal cual — nada de
// lógica de negocio nueva.
//
// Soporta los tres tipos de item (cuota, cargo puntual, Muro Libre): cada uno
// se reconstruye con la forma que espera registrarCobro.service.js. Los
// cargos puntuales llevan `esPagoParcial` desde el propio Cobro.items (antes
// no se guardaba ahí, se perdía si el pago original había sido "a cuenta").
export const cambiarFormaPagoCobro = async ({ clubId, user, cobroId, paymentMethod }) => {
  if (!clubId) throw new BusinessError('No se pudo determinar el club del usuario', 401);
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new BusinessError('La forma de pago debe ser Efectivo o Transferencia');
  }

  const cobroPrevio = await Cobro.findOne({ _id: cobroId, clubId, active: true }).lean();
  if (!cobroPrevio) throw new BusinessError('Cobro no encontrado', 404);

  if (cobroPrevio.paymentMethod === paymentMethod) {
    throw new BusinessError(`El cobro ya está registrado como ${paymentMethod}`);
  }

  if (cobroPrevio.movimientoId) {
    const movimiento = await Movimiento.findOne({ _id: cobroPrevio.movimientoId, clubId }).lean();
    if (movimiento?.mercadopagoVinculos?.length > 0) {
      throw new BusinessError('Este movimiento tiene pagos de Mercado Pago vinculados — desvinculalos primero.');
    }
  }

  const actor = user?.email || user?.id;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const cobro = await Cobro.findOne({ _id: cobroId, clubId, active: true }).session(session);
      if (!cobro) throw new BusinessError('Cobro no encontrado', 404);

      if (cobro.movimientoId) {
        await Movimiento.findByIdAndUpdate(
          cobro.movimientoId,
          { active: false, updatedBy: actor },
          { session },
        );
      }

      await anularCobroConTrazabilidad({
        cobro,
        clubId,
        actor,
        motivo: `Corrección de forma de pago (${cobroPrevio.paymentMethod} → ${paymentMethod})`,
        session,
      });
    });
  } finally {
    session.endSession();
  }

  // Reconstruye la forma de item que espera registrarCobro.service.js según
  // el tipo real — `amount` siempre explícito para no recalcular contra el
  // precio vigente actual (puede haber cambiado desde el cobro original) ni
  // redistribuirlo entre períodos.
  const items = cobroPrevio.items.map((item) => {
    if (item.cargoPuntualId) {
      return {
        socioId: String(item.socioId),
        cargoPuntualId: String(item.cargoPuntualId),
        amount: item.amount,
        esPagoParcial: Boolean(item.esPagoParcial),
        ...(item.description ? { description: item.description } : {}),
      };
    }
    if (item.asistenciaId) {
      return {
        socioId: String(item.socioId),
        muroLibrePendiente: true,
        asistenciaIds: [String(item.asistenciaId)],
        amount: item.amount,
      };
    }
    return {
      socioId: String(item.socioId),
      suscripcionId: String(item.suscripcionId),
      periodos: [item.periodo],
      amount: item.amount,
      ...(item.precioSugeridoSnapshot != null ? { precioSugeridoSnapshot: item.precioSugeridoSnapshot } : {}),
      ...(item.description ? { description: item.description } : {}),
    };
  });

  return registrarCobro({
    clubId,
    user,
    // Un cobro a precio de cada mes (#285) se rehace con los mismos importes y
    // conserva modo y motivo. No vuelve a pedir cobros:precio-historico: no es
    // un cobro nuevo a otro precio, es el mismo con otra forma de pago.
    precioHistoricoHeredado: cobroPrevio.modoPrecio === 'historico'
      ? { motivo: cobroPrevio.motivoPrecioHistorico }
      : null,
    body: {
      paymentMethod,
      date: cobroPrevio.date,
      description: cobroPrevio.description || undefined,
      items,
    },
  });
};

export { BusinessError };
export default cambiarFormaPagoCobro;
