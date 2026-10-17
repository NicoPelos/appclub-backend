import mongoose from 'mongoose';
import AuditLog from '../../audit/models/AuditLog.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { REVERSERS } from '../../audit/services/reversers/index.js';

const OMIT_FIELDS = ['_id', '__v', 'createdAt', 'updatedAt'];

// Igual que revertAuditLog.handler.js (recurso normal), salvo que no filtra
// por clubId del actor: el superadmin no pertenece a ningún club real, así
// que necesita poder revertir el log de cualquier club.
const conflicto = (mensaje) => Object.assign(new Error(mensaje), { status: 409 });

export const revertSuperAuditHandler = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID de log inválido' });
  }

  const actor = req.user.email || String(req.user.id);
  const reclamar = (session) => AuditLog.findOneAndUpdate(
    { _id: id, revertedAt: null },
    { $set: { revertedAt: new Date(), revertedBy: actor } },
    { new: true, ...(session ? { session } : {}) },
  );

  const session = await mongoose.startSession();
  try {
    const log = await AuditLog.findById(id);
    if (!log) return res.status(404).json({ message: 'Log de auditoría no encontrado' });

    if (log.revertedAt) {
      return res.status(409).json({ message: 'Este log ya fue revertido', revertedAt: log.revertedAt, revertedBy: log.revertedBy });
    }

    const reverser = REVERSERS[log.resource];
    let reclamado = null;

    if (reverser) {
      await session.withTransaction(async () => {
        // El claim va dentro de la transacción: dos reverts simultáneos del
        // mismo log no pueden ejecutar los dos (appcarc-backend#239).
        reclamado = await reclamar(session);
        if (!reclamado) throw conflicto('Este log ya fue revertido');
        await reverser(log, { actor, session });
      });
    } else {
      reclamado = await reclamar();
      if (!reclamado) throw conflicto('Este log ya fue revertido');
      try {
        await revertirGenerico(log, actor);
      } catch (error) {
        await AuditLog.updateOne({ _id: id }, { $set: { revertedAt: null, revertedBy: null } });
        throw error;
      }
    }

    logAudit({
      clubId: log.clubId,
      req,
      action: log.action === 'CREATE' ? 'DELETE' : 'UPDATE',
      resource: log.resource,
      resourceId: log.resourceId,
      before: log.after,
      after: log.before,
    });

    return res.status(200).json({ message: 'Cambio revertido correctamente', log: reclamado });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    if (error.name === 'MissingSchemaError') {
      return res.status(422).json({ message: `No se encontró el modelo '${error.message}'` });
    }
    console.error('Error revirtiendo audit log (super):', error);
    return res.status(500).json({ message: 'Error al revertir cambio' });
  } finally {
    session.endSession();
  }
};

const revertirGenerico = async (log, actor) => {
  const Model = mongoose.model(log.resource);

  if (log.action === 'CREATE') {
    const actualizado = await Model.findByIdAndUpdate(log.resourceId, { $set: { active: false, updatedBy: actor } }, { upsert: false });
    if (!actualizado) throw Object.assign(new Error('No se encontró el documento a revertir'), { status: 422 });
    return;
  }

  if (log.action === 'UPDATE' || log.action === 'DELETE') {
    if (!log.before) throw Object.assign(new Error('No hay snapshot anterior para revertir'), { status: 422 });

    const restoredData = Object.fromEntries(
      Object.entries(log.before).filter(([k]) => !OMIT_FIELDS.includes(k)),
    );
    restoredData.updatedBy = actor;

    const actualizado = await Model.findByIdAndUpdate(log.resourceId, { $set: restoredData }, { upsert: false });
    if (!actualizado) throw Object.assign(new Error('No se encontró el documento a revertir'), { status: 422 });
  }
};
