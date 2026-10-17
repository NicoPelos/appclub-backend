import mongoose from 'mongoose';
import { cambiarFormaPagoEventoParticipante, BusinessError } from '../services/cambiarFormaPagoEventoParticipante.service.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/eventos/{eventoId}/participantes/{participanteId}/pagos/{movimientoId}/forma-pago:
 *   put:
 *     summary: Corregir la forma de pago de un pago puntual de un participante (anula ese pago y lo vuelve a registrar)
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventoId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: participanteId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: movimientoId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentMethod]
 *             properties:
 *               paymentMethod:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *     responses:
 *       201:
 *         description: Forma de pago corregida
 *       400:
 *         description: Datos inválidos, ya está en esa forma de pago, o tiene pagos de Mercado Pago vinculados
 *       404:
 *         description: Movimiento o participante no encontrado
 */
export const cambiarFormaPagoEventoParticipanteHandler = async (req, res) => {
  try {
    const { eventoId, participanteId, movimientoId } = req.params;
    if (![eventoId, participanteId, movimientoId].every((id) => mongoose.Types.ObjectId.isValid(id))) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const result = await cambiarFormaPagoEventoParticipante({
      clubId: req.user?.clubId,
      user: req.user,
      eventoId,
      participanteId,
      movimientoId,
      paymentMethod: req.body?.paymentMethod,
    });

    // El pago original ya quedó auditado por su propia anulación (dentro de
    // anularPagoEventoParticipante); esto deja el rastro de que fue
    // reemplazado por este otro, con la forma de pago corregida.
    logAudit({
      clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'EventoParticipantePago', resourceId: movimientoId,
      before: null,
      after: { motivo: 'Corrección de forma de pago', movimientoNuevoId: result.movimiento._id, paymentMethod: req.body?.paymentMethod },
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error cambiando forma de pago del pago del participante:', error);
    return res.status(500).json({ message: 'Error al cambiar la forma de pago' });
  }
};

export default cambiarFormaPagoEventoParticipanteHandler;
