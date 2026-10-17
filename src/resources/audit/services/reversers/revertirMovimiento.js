import mongoose from 'mongoose';
import { restoreFields } from './shared.js';

// Los movimientos creados/editados a mano (sourceModel null) no tienen
// cascada: revertirlos es el mismo soft-delete/restore genérico de siempre.
// La única cascada real ocurre al borrar un movimiento que provino de un
// Cobro o de un registro de muro libre (ver deleteMovimiento.handler.js) —
// ahí sí hay que reactivar el documento de origen.
export async function revertirMovimiento(log, { actor, session }) {
  const Movimiento = mongoose.model('Movimiento');

  if (log.action === 'CREATE') {
    const actualizado = await Movimiento.findOneAndUpdate(
      { _id: log.resourceId, clubId: log.clubId },
      { $set: { active: false, updatedBy: actor } },
      { session },
    );
    // appcarc-backend#221: si no se encontró, el handler igual marca el log
    // como revertido y responde 200 sin haber tocado nada.
    if (!actualizado) {
      const error = new Error(`No se encontró el Movimiento ${log.resourceId} en el club ${log.clubId}`);
      error.status = 422;
      throw error;
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
    const actualizado = await Movimiento.findOneAndUpdate(
      { _id: log.resourceId, clubId: log.clubId },
      { $set: restored },
      { session },
    );
    if (!actualizado) {
      const error = new Error(`No se encontró el Movimiento ${log.resourceId} en el club ${log.clubId}`);
      error.status = 422;
      throw error;
    }

    if (log.action !== 'DELETE') return;

    if (log.before.sourceModel === 'Cobro' && log.before.sourceId) {
      const Cobro = mongoose.model('Cobro');
      const Cuota = mongoose.model('Cuota');
      const cobro = await Cobro.findOne({ _id: log.before.sourceId, clubId: log.clubId }).session(session);
      if (cobro && !cobro.active) {
        cobro.active = true;
        cobro.anuladoAt = null;
        cobro.anuladoPor = null;
        cobro.motivoAnulacion = null;
        cobro.updatedBy = actor;
        await cobro.save({ session });

        await Cuota.updateMany(
          { cobroId: cobro._id, clubId: log.clubId, estado: 'anulada' },
          { estado: 'pagada', updatedBy: actor },
          { session },
        );
      }
    } else if (log.before.sourceModel === 'Asistencia' && log.before.sourceId) {
      const Asistencia = mongoose.model('Asistencia');
      await Asistencia.findOneAndUpdate(
        { _id: log.before.sourceId, clubId: log.clubId },
        { active: true, updatedBy: actor },
        { session },
      );
    }
  }
}

export default revertirMovimiento;
