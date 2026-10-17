import fs from 'fs';
import path from 'path';
import Movimiento from '../models/Movimiento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/movimientos/{id}/comprobantes/{comprobanteId}:
 *   delete:
 *     summary: Eliminar una foto de comprobante de un movimiento
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: comprobanteId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Comprobante eliminado
 *       404:
 *         description: Movimiento o comprobante no encontrado
 */
export const deleteComprobanteHandler = async (req, res) => {
  try {
    const { id, comprobanteId } = req.params;

    const movimiento = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!movimiento) return res.status(404).json({ message: 'Movimiento no encontrado' });

    const comprobante = movimiento.comprobantes.id(comprobanteId);
    if (!comprobante) return res.status(404).json({ message: 'Comprobante no encontrado' });

    const filename = path.basename(comprobante.url);
    fs.unlink(path.resolve('uploads/comprobantes', filename), () => {}); // best-effort, no bloquea si ya no está

    const actor = getActor(req);
    comprobante.deleteOne();
    movimiento.updatedBy = actor;
    await movimiento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before: { comprobanteEliminado: comprobante.url }, after: null });
    res.status(200).json({ message: 'Comprobante eliminado' });
  } catch (error) {
    console.error('Error eliminando comprobante:', error);
    res.status(500).json({ message: 'Error al eliminar el comprobante' });
  }
};

export default deleteComprobanteHandler;
