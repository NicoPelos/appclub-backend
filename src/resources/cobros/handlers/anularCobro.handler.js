import mongoose from 'mongoose';
import Cobro from '../models/Cobro.js';
import Movimiento from '../../movimientos/models/Movimiento.js';
import { anularCobroConTrazabilidad } from '../services/anularCobro.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/cobros/{id}/anular:
 *   post:
 *     summary: Anular un cobro (soft delete)
 *     tags: [Cobros]
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
 *                 description: Motivo de la anulación (opcional)
 *     responses:
 *       200:
 *         description: Cobro anulado correctamente
 *       404:
 *         description: Cobro no encontrado
 *       409:
 *         description: El cobro ya está anulado
 */
export const anularCobroHandler = async (req, res) => {
  const { id } = req.params;
  const motivo = String(req.body?.motivo || '').trim();
  const actor = getActor(req);

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ message: 'ID de cobro inválido' });
  }

  const session = await mongoose.startSession();
  try {
    let result = null;
    let cobroAntes = null;

    await session.withTransaction(async () => {
      const cobro = await Cobro.findOne({ _id: id, clubId: req.user?.clubId }).session(session);
      if (cobro && cobro.active) cobroAntes = cobro.toObject();

      if (!cobro) {
        const error = new Error('Cobro no encontrado');
        error.status = 404;
        throw error;
      }

      if (!cobro.active) {
        const error = new Error('El cobro ya está anulado');
        error.status = 409;
        throw error;
      }

      if (cobro.movimientoId) {
        await Movimiento.findByIdAndUpdate(
          cobro.movimientoId,
          { active: false, updatedBy: actor },
          { session },
        );
      }

      await anularCobroConTrazabilidad({ cobro, clubId: req.user?.clubId, actor, motivo, session });

      result = { cobro };
    });

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Cobro', resourceId: id, before: cobroAntes, after: null });
    return res.status(200).json({ message: 'Cobro anulado correctamente', cobro: result.cobro });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error anulando cobro:', error);
    return res.status(500).json({ message: 'Error al anular cobro' });
  } finally {
    session.endSession();
  }
};

export default anularCobroHandler;
