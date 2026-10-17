import mongoose from 'mongoose';
import { restoreFields } from './shared.js';

// El resource 'Asistencia' en el audit log solo se usa para muro libre (ver
// createMuroLibre/updateMuroLibre/deleteMuroLibre.handler.js) — el check-in de
// escuelita no loguea auditoría. Cuando el pase queda "pagado" se crea/edita
// en paralelo un Movimiento (registro.movimientoId), así que revertir estos
// cambios también tiene que sincronizar ese movimiento.
export async function revertirMuroLibre(log, { actor, session }) {
  const Asistencia = mongoose.model('Asistencia');
  const Movimiento = mongoose.model('Movimiento');

  if (log.action === 'CREATE') {
    const asistenciaActualizada = await Asistencia.findOneAndUpdate(
      { _id: log.resourceId, clubId: log.clubId },
      { $set: { active: false, updatedBy: actor } },
      { session },
    );
    // appcarc-backend#221: si no se encontró, el handler igual marca el log
    // como revertido y responde 200 sin haber tocado nada.
    if (!asistenciaActualizada) {
      const error = new Error(`No se encontró la Asistencia ${log.resourceId} en el club ${log.clubId}`);
      error.status = 422;
      throw error;
    }

    if (log.after?.movimientoId) {
      const movimientoActualizado = await Movimiento.findOneAndUpdate(
        { _id: log.after.movimientoId, clubId: log.clubId },
        { active: false, updatedBy: actor },
        { session },
      );
      if (!movimientoActualizado) {
        console.error(`revertirMuroLibre: Movimiento ${log.after.movimientoId} no encontrado en el club ${log.clubId}`);
      }
    }
    return;
  }

  if (log.action === 'UPDATE' || log.action === 'DELETE') {
    if (!log.before) {
      const error = new Error('No hay snapshot anterior para revertir');
      error.status = 422;
      throw error;
    }

    const restored = restoreFields(log.before);
    restored.updatedBy = actor;
    const asistenciaActualizada = await Asistencia.findOneAndUpdate(
      { _id: log.resourceId, clubId: log.clubId },
      { $set: restored },
      { session },
    );
    if (!asistenciaActualizada) {
      const error = new Error(`No se encontró la Asistencia ${log.resourceId} en el club ${log.clubId}`);
      error.status = 422;
      throw error;
    }

    const movimientoId = log.before.movimientoId;
    if (!movimientoId) return;

    if (log.action === 'DELETE') {
      const movimientoActualizado = await Movimiento.findOneAndUpdate(
        { _id: movimientoId, clubId: log.clubId },
        { active: true, updatedBy: actor },
        { session },
      );
      if (!movimientoActualizado) {
        console.error(`revertirMuroLibre: Movimiento ${movimientoId} no encontrado en el club ${log.clubId}`);
      }
      return;
    }

    // UPDATE: updateMuroLibre.handler.js mantiene monto/formaPago del
    // registro siempre igual a amount/paymentMethod del movimiento vinculado,
    // así que el snapshot "before" de la Asistencia alcanza para saber a qué
    // valor volver el movimiento.
    const camposMovimiento = {};
    if (log.before.monto !== undefined) camposMovimiento.amount = log.before.monto;
    if (log.before.formaPago !== undefined) camposMovimiento.paymentMethod = log.before.formaPago;
    if (Object.keys(camposMovimiento).length) {
      camposMovimiento.updatedBy = actor;
      const movimientoActualizado = await Movimiento.findOneAndUpdate(
        { _id: movimientoId, clubId: log.clubId },
        { $set: camposMovimiento },
        { session },
      );
      if (!movimientoActualizado) {
        console.error(`revertirMuroLibre: Movimiento ${movimientoId} no encontrado en el club ${log.clubId}`);
      }
    }
  }
}

export default revertirMuroLibre;
