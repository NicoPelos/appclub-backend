import Socio from '../models/Socio.js';
import { logAudit } from '../../audit/services/audit.service.js';

/** * @openapi
 * /api/socios/{id}/restore:
 *   put:
 *     summary: Restaurar socio eliminado
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         description: ID del socio a restaurar
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Socio restaurado con éxito
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Socio'
 *       404:
 *         description: Socio no encontrado o no está en papelera
 *       500:
 *         description: Error al restaurar socio
 */

export const restoreSocioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const socio = await Socio.findOneAndUpdate(
      { _id: id, clubId: req.user?.clubId, active: false },
      {
        active: true,
        deletedAt: undefined,
        deletedBy: undefined,
        updatedBy: req.user?.id,
      },
      { returnDocument: 'after' }
    );
    if (!socio) return res.status(404).json({ message: 'Socio no encontrado o no está en papelera' });

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Socio', resourceId: socio._id, before: null, after: socio.toObject() });

    res.status(200).json(socio);
  } catch (error) {
    console.error('Error restaurando socio (handler):', error);
    res.status(500).json({ message: 'Error al restaurar socio' });
  }
};

export default restoreSocioHandler;
