import mongoose from 'mongoose';
import Movimiento from '../models/Movimiento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const MAX_IDS = 200;

/**
 * @openapi
 * /api/movimientos/fecha-bulk:
 *   post:
 *     summary: Cambiar la fecha de varios movimientos de caja a la vez
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ids, date]
 *             properties:
 *               ids:
 *                 type: array
 *                 maxItems: 200
 *                 items:
 *                   type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Fechas actualizadas. Los ids que no existen o no son del club se informan en `ignorados`.
 *       400:
 *         description: Datos inválidos
 *       500:
 *         description: Error al actualizar las fechas
 */
export const updateFechaBulkHandler = async (req, res) => {
  try {
    const { ids, date } = req.body ?? {};

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ message: 'Falta ids' });
    }
    if (ids.length > MAX_IDS) {
      return res.status(400).json({ message: `Como máximo se pueden cambiar ${MAX_IDS} movimientos por vez` });
    }
    if (!ids.every((id) => mongoose.isValidObjectId(id))) {
      return res.status(400).json({ message: 'Hay ids de movimiento inválidos' });
    }

    const nuevaFecha = new Date(date);
    if (!date || Number.isNaN(nuevaFecha.getTime())) {
      return res.status(400).json({ message: 'La fecha del movimiento es inválida' });
    }

    const actor = getActor(req);
    const idsUnicos = [...new Set(ids)];
    const movimientos = await Movimiento.find({ _id: { $in: idsUnicos }, clubId: req.user?.clubId, active: true });

    for (const movimiento of movimientos) {
      const antes = movimiento.toObject();
      movimiento.date = nuevaFecha;
      movimiento.updatedBy = actor;
      await movimiento.save();
      logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before: antes, after: movimiento.toObject() });
    }

    res.status(200).json({ actualizados: movimientos.length, ignorados: idsUnicos.length - movimientos.length });
  } catch (error) {
    console.error('Error cambiando la fecha de movimientos en lote:', error);
    res.status(500).json({ message: 'Error al actualizar las fechas' });
  }
};

export default updateFechaBulkHandler;
