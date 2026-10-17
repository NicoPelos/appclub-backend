import mongoose from 'mongoose';
import { restoreFields } from './shared.js';

// Un Cobro siempre nace con un Movimiento e impacta Cuotas asociadas (ver
// registrarCobro.service.js). anularCobro.handler.js es la única forma de
// "borrarlo" (soft-delete con cascada). Por eso revertir su creación equivale
// a re-aplicar esa misma cascada de anulación, y revertir su anulación
// equivale a deshacerla.
export async function revertirCobro(log, { actor, session }) {
  const Cobro = mongoose.model('Cobro');
  const Movimiento = mongoose.model('Movimiento');
  const Cuota = mongoose.model('Cuota');

  if (log.action === 'CREATE') {
    const cobro = await Cobro.findOne({ _id: log.resourceId, clubId: log.clubId }).session(session);
    // appcarc-backend#221: sin tirar acá, el handler igual marca el log
    // como revertido y responde 200 aunque no se haya tocado nada — el admin
    // cree que revirtió, y el log queda con 409 para siempre sin poder
    // reintentar de verdad.
    if (!cobro) {
      const error = new Error(`No se encontró el Cobro ${log.resourceId} en el club ${log.clubId}`);
      error.status = 422;
      throw error;
    }
    if (!cobro.active) {
      const error = new Error('El cobro ya estaba anulado');
      error.status = 422;
      throw error;
    }

    cobro.active = false;
    cobro.anuladoAt = new Date();
    cobro.anuladoPor = actor;
    cobro.motivoAnulacion = 'Anulado al revertir la creación del cobro';
    cobro.updatedBy = actor;
    await cobro.save({ session });

    if (cobro.movimientoId) {
      const movimientoActualizado = await Movimiento.findOneAndUpdate(
        { _id: cobro.movimientoId, clubId: log.clubId },
        { active: false, updatedBy: actor },
        { session },
      );
      if (!movimientoActualizado) {
        console.error(`revertirCobro: Movimiento ${cobro.movimientoId} no encontrado en el club ${log.clubId}`);
      }
    }

    await Cuota.updateMany(
      { cobroId: cobro._id, clubId: log.clubId },
      { estado: 'anulada', updatedBy: actor },
      { session },
    );
    return;
  }

  if (log.action === 'DELETE') {
    if (!log.before) {
      const error = new Error('No hay snapshot anterior para revertir');
      error.status = 422;
      throw error;
    }

    const restored = restoreFields(log.before);
    restored.updatedBy = actor;
    const cobroActualizado = await Cobro.findOneAndUpdate(
      { _id: log.resourceId, clubId: log.clubId },
      { $set: restored },
      { session },
    );
    if (!cobroActualizado) {
      const error = new Error(`No se encontró el Cobro ${log.resourceId} en el club ${log.clubId}`);
      error.status = 422;
      throw error;
    }

    if (log.before.movimientoId) {
      const movimientoActualizado = await Movimiento.findOneAndUpdate(
        { _id: log.before.movimientoId, clubId: log.clubId },
        { active: true, updatedBy: actor },
        { session },
      );
      if (!movimientoActualizado) {
        console.error(`revertirCobro: Movimiento ${log.before.movimientoId} no encontrado en el club ${log.clubId}`);
      }
    }

    await Cuota.updateMany(
      { cobroId: log.resourceId, clubId: log.clubId, estado: 'anulada' },
      { estado: 'pagada', updatedBy: actor },
      { session },
    );
  }
}

export default revertirCobro;
