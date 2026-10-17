import mongoose from 'mongoose';
import AuditLog from '../models/AuditLog.js';
import { logAudit } from '../services/audit.service.js';
import { REVERSERS } from '../services/reversers/index.js';
import { restoreFields } from '../services/reversers/shared.js';

/**
 * @openapi
 * /api/audit/{id}/revert:
 *   post:
 *     summary: Revertir un cambio registrado en el log de auditoría (solo admin)
 *     tags: [Audit]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cambio revertido correctamente
 *       404:
 *         description: Log no encontrado
 *       409:
 *         description: Este log ya fue revertido
 *       422:
 *         description: No se puede revertir (no hay snapshot before disponible)
 */
// Reclama el log de forma atómica (revertedAt: null -> ahora) en vez de leer
// revertedAt y guardarlo recién al final — appcarc-backend#222: dos requests
// simultáneos (doble click, reintento del cliente) pasaban ambos el chequeo
// en memoria y ejecutaban el revert dos veces. findOneAndUpdate con el mismo
// filtro que decide el 409 hace que como mucho uno de los dos gane la carrera.
const reclamarLog = async ({ id, clubId, actor, session }) => {
  const claimed = await AuditLog.findOneAndUpdate(
    { _id: id, clubId, revertedAt: null },
    { $set: { revertedAt: new Date(), revertedBy: actor } },
    session ? { session } : {},
  );
  if (!claimed) {
    const error = new Error('Este log ya fue revertido');
    error.status = 409;
    throw error;
  }
  return claimed;
};

export const revertAuditLogHandler = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID de log inválido' });
  }

  const session = await mongoose.startSession();
  try {
    const preCheck = await AuditLog.findOne({ _id: id, clubId: req.user.clubId });
    if (!preCheck) return res.status(404).json({ message: 'Log de auditoría no encontrado' });

    if (preCheck.revertedAt) {
      return res.status(409).json({ message: 'Este log ya fue revertido', revertedAt: preCheck.revertedAt, revertedBy: preCheck.revertedBy });
    }

    const actor = req.user.email || String(req.user.id);
    const reverser = REVERSERS[preCheck.resource];
    let log;

    if (reverser) {
      // Recursos con efectos en cascada (Cobro, Movimiento, Asistencia): el
      // reclamo va DENTRO de la misma transacción que el reverser, así que
      // si este tira (ej. nada que revertir de verdad, appcarc-backend#221)
      // Mongo deshace el reclamo junto con cualquier escritura parcial —
      // el log queda disponible para reintentar, no revertido en falso.
      await session.withTransaction(async () => {
        log = await reclamarLog({ id, clubId: req.user.clubId, actor, session });
        await reverser(log, { actor, session });
      });
    } else {
      log = await reclamarLog({ id, clubId: req.user.clubId, actor });
      try {
        const Model = mongoose.model(log.resource);

        if (log.action === 'CREATE') {
          // Revertir un CREATE → soft-delete el documento creado. Filtrar
          // por clubId (igual que la búsqueda del log más arriba) es una
          // capa de defensa extra: el resourceId ya viene de un log
          // scopeado a este club, pero si algún día no lo estuviera, esto
          // evita tocar un documento de otro club (appcarc-backend#91).
          const actualizado = await Model.findOneAndUpdate(
            { _id: log.resourceId, clubId: log.clubId },
            { $set: { active: false, updatedBy: actor } },
          );
          if (!actualizado) {
            const error = new Error('No se encontró el documento a revertir en este club');
            error.status = 422;
            throw error;
          }
        } else if (log.action === 'UPDATE' || log.action === 'DELETE') {
          // Revertir UPDATE o DELETE → restaurar el snapshot before
          if (!log.before) {
            const error = new Error('No hay snapshot anterior para revertir');
            error.status = 422;
            throw error;
          }

          const restoredData = restoreFields(log.before);
          restoredData.updatedBy = actor;

          const actualizado = await Model.findOneAndUpdate(
            { _id: log.resourceId, clubId: log.clubId },
            { $set: restoredData },
          );
          if (!actualizado) {
            const error = new Error('No se encontró el documento a revertir en este club');
            error.status = 422;
            throw error;
          }
        }
      } catch (genericError) {
        // Sin transacción acá (el revert genérico es de un único documento,
        // no cascadea) — si falló después de reclamar, hay que deshacer el
        // reclamo a mano para no dejar el log marcado como revertido en falso.
        await AuditLog.updateOne(
          { _id: id, clubId: req.user.clubId },
          { $set: { revertedAt: null, revertedBy: null } },
        ).catch(() => {});
        throw genericError;
      }
    }

    logAudit({
      clubId: req.user.clubId,
      req,
      action: log.action === 'CREATE' ? 'DELETE' : 'UPDATE',
      resource: log.resource,
      resourceId: log.resourceId,
      before: log.after,
      after: log.before,
    });

    return res.status(200).json({ message: 'Cambio revertido correctamente', log });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error.name === 'MissingSchemaError') {
      return res.status(422).json({ message: `No se encontró el modelo '${error.message}'` });
    }
    console.error('Error revirtiendo audit log:', error);
    return res.status(500).json({ message: 'Error al revertir cambio' });
  } finally {
    session.endSession();
  }
};

export default revertAuditLogHandler;
