import Etiqueta from '../models/Etiqueta.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/etiquetas/{id}:
 *   delete:
 *     summary: Eliminar etiqueta (soft delete, solo admin)
 *     tags: [Etiquetas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Etiqueta eliminada
 *       404:
 *         description: Etiqueta no encontrada
 *       500:
 *         description: Error al eliminar etiqueta
 */
export const deleteEtiquetaHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const etiqueta = await Etiqueta.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!etiqueta) return res.status(404).json({ message: 'Etiqueta no encontrada' });
    const etiquetaAntes = etiqueta.toObject();

    etiqueta.active = false;
    etiqueta.deletedAt = new Date();
    etiqueta.deletedBy = getActor(req);
    etiqueta.updatedBy = getActor(req);
    await etiqueta.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Etiqueta', resourceId: etiqueta._id, before: etiquetaAntes, after: null });
    return res.status(200).json({ message: 'Etiqueta eliminada' });
  } catch (error) {
    console.error('Error eliminando etiqueta:', error);
    return res.status(500).json({ message: 'Error al eliminar etiqueta' });
  }
};

export default deleteEtiquetaHandler;
