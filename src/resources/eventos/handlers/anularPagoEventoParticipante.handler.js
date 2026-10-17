import mongoose from 'mongoose';
import Movimiento from '../../movimientos/models/Movimiento.js';
import EventoParticipante from '../models/EventoParticipante.js';
import { anularPagoEventoParticipante } from '../services/anularPagoEventoParticipante.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/eventos/{eventoId}/participantes/{participanteId}/pagos/{movimientoId}:
 *   delete:
 *     summary: Anular un pago puntual de un participante (revierte solo ese pago, no todo el historial)
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
 *     responses:
 *       200:
 *         description: Pago anulado
 *       404:
 *         description: Participante o pago no encontrado
 *       500:
 *         description: Error al anular el pago
 */
export const anularPagoEventoParticipanteHandler = async (req, res) => {
  const { eventoId, participanteId, movimientoId } = req.params;
  if (![eventoId, participanteId, movimientoId].every((id) => mongoose.Types.ObjectId.isValid(id))) {
    return res.status(400).json({ message: 'ID inválido' });
  }

  const session = await mongoose.startSession();
  try {
    let participanteActualizado = null;
    const actor = getActor(req);

    await session.withTransaction(async () => {
      const participante = await EventoParticipante.findOne({
        _id: participanteId, eventoId, clubId: req.user.clubId, active: true,
      }).session(session);
      if (!participante) {
        const error = new Error('Participante no encontrado');
        error.status = 404;
        throw error;
      }
      const pago = participante.pagos.find((p) => String(p.movimientoId) === movimientoId);
      if (!pago) {
        const error = new Error('Ese pago no pertenece a este participante');
        error.status = 404;
        throw error;
      }

      await Movimiento.findByIdAndUpdate(movimientoId, { active: false, updatedBy: actor }, { session });
      participanteActualizado = await anularPagoEventoParticipante({ clubId: req.user.clubId, movimientoId, actor, session });
    });

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'EventoParticipantePago', resourceId: movimientoId, before: null, after: null });
    return res.status(200).json(participanteActualizado);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error('Error anulando el pago del participante:', error);
    return res.status(500).json({ message: 'Error al anular el pago' });
  } finally {
    session.endSession();
  }
};

export default anularPagoEventoParticipanteHandler;
