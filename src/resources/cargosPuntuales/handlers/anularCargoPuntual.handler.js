import { anularCargoPuntual, BusinessError } from '../services/anularCargoPuntual.service.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/cargos-puntuales/{id}/anular:
 *   post:
 *     summary: Anular un cargo puntual pendiente (atribuido por error)
 *     tags: [CargosPuntuales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motivo:
 *                 type: string
 *     responses:
 *       200:
 *         description: Cargo puntual anulado
 *       404:
 *         description: No encontrado
 *       409:
 *         description: El cargo ya no está pendiente
 */
export const anularCargoPuntualHandler = async (req, res) => {
  try {
    const cargo = await anularCargoPuntual({
      clubId: req.user?.clubId,
      user: req.user,
      id: req.params.id,
      motivo: String(req.body?.motivo || '').trim(),
    });
    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'CargoPuntual', resourceId: cargo._id, before: null, after: cargo.toObject() });
    return res.status(200).json(cargo);
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error anulando cargo puntual:', error);
    return res.status(500).json({ message: 'Error al anular cargo puntual' });
  }
};

export default anularCargoPuntualHandler;
