import Precios from '../models/Precios.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/precios/{id}:
 *   delete:
 *     summary: Eliminar precio (soft delete, solo admin)
 *     tags: [Precios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Precio eliminado
 *       404:
 *         description: Precio no encontrado
 *       500:
 *         description: Error al eliminar precio
 */
export const deletePrecioHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const precio = await Precios.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!precio) return res.status(404).json({ message: 'Precio no encontrado' });
    const precioAntes = precio.toObject();

    precio.active = false;
    precio.deletedAt = new Date();
    precio.deletedBy = getActor(req);
    precio.updatedBy = getActor(req);
    await precio.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Precios', resourceId: precio._id, before: precioAntes, after: null });
    return res.status(200).json({ message: 'Precio eliminado correctamente' });
  } catch (error) {
    console.error('Error eliminando precio:', error);
    return res.status(500).json({ message: 'Error al eliminar precio' });
  }
};

export default deletePrecioHandler;
