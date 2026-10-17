import mongoose from 'mongoose';
import Suscripcion from '../models/Suscripcion.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { sincronizarEscuelitaPorSuscripcionModificada } from '../../escuelita/services/sincronizarSuscripcionPlan.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/suscripciones/{id}:
 *   delete:
 *     summary: Eliminar suscripción (soft delete, solo admin)
 *     tags: [Suscripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Suscripción eliminada
 *       404:
 *         description: Suscripción no encontrada
 *       500:
 *         description: Error al eliminar suscripción
 */
export const deleteSuscripcionHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { id } = req.params;

    const suscripcion = await Suscripcion.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!suscripcion) {
      return res.status(404).json({ message: 'Suscripción no encontrada' });
    }
    const suscripcionAntes = suscripcion.toObject();

    await session.withTransaction(async () => {
      suscripcion.active = false;
      suscripcion.updatedBy = getActor(req);
      await suscripcion.save({ session });

      await sincronizarEscuelitaPorSuscripcionModificada({
        clubId: req.user.clubId, socioId: suscripcion.socioId, etiquetaId: suscripcion.etiquetaId, req, session,
      });
    });

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Suscripcion', resourceId: suscripcion._id, before: suscripcionAntes, after: null });
    return res.status(200).json({ message: 'Suscripción eliminada' });
  } catch (error) {
    console.error('Error eliminando suscripción:', error);
    return res.status(500).json({ message: 'Error al eliminar suscripción' });
  } finally {
    session.endSession();
  }
};

