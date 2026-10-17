import Plan from '../models/Plan.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/planes/{id}:
 *   delete:
 *     summary: Eliminar un plan (soft delete)
 *     tags: [Planes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Plan eliminado
 *       404:
 *         description: Plan no encontrado
 *       409:
 *         description: No se puede eliminar — hay suscripciones activas con este plan
 *       500:
 *         description: Error al eliminar plan
 */
export const deletePlanHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const plan = await Plan.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!plan) return res.status(404).json({ message: 'Plan no encontrado' });

    const suscripcionesActivas = await Suscripcion.countDocuments({ clubId: req.user.clubId, planId: id, active: true, fechaHasta: null });
    if (suscripcionesActivas > 0) {
      return res.status(409).json({ message: `No se puede eliminar: hay ${suscripcionesActivas} suscripción/es activa/s con este plan` });
    }

    const planAntes = plan.toObject();
    plan.active = false;
    plan.deletedAt = new Date();
    plan.deletedBy = getActor(req);
    plan.updatedBy = getActor(req);
    await plan.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Plan', resourceId: plan._id, before: planAntes, after: null });
    return res.status(200).json({ message: 'Plan eliminado' });
  } catch (error) {
    console.error('Error eliminando plan:', error);
    return res.status(500).json({ message: 'Error al eliminar plan' });
  }
};

export default deletePlanHandler;
