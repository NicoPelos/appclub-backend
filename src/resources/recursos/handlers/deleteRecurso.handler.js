import RecursoExterno from '../models/RecursoExterno.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/recursos/{id}:
 *   delete:
 *     summary: Eliminar un recurso externo (soft delete)
 *     tags: [Recursos externos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Recurso eliminado
 *       404:
 *         description: Recurso no encontrado
 *       500:
 *         description: Error al eliminar recurso
 */
export const deleteRecursoHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const recurso = await RecursoExterno.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!recurso) return res.status(404).json({ message: 'Recurso no encontrado' });
    const recursoAntes = recurso.toObject();

    recurso.active = false;
    recurso.deletedAt = new Date();
    recurso.deletedBy = getActor(req);
    recurso.updatedBy = getActor(req);
    await recurso.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'RecursoExterno', resourceId: recurso._id, before: recursoAntes, after: null });
    return res.status(200).json({ message: 'Recurso eliminado' });
  } catch (error) {
    console.error('Error eliminando recurso:', error);
    return res.status(500).json({ message: 'Error al eliminar recurso' });
  }
};

export default deleteRecursoHandler;
