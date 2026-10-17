import mongoose from 'mongoose';
import EventoParticipante from '../models/EventoParticipante.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/eventos/{eventoId}/participantes/{participanteId}/anular:
 *   post:
 *     summary: Sacar a un participante del roster (solo si no tiene pagos reales)
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
 *     responses:
 *       200:
 *         description: Participante anulado
 *       404:
 *         description: Participante no encontrado
 *       409:
 *         description: Ya está anulado, o tiene pagos registrados (hay que anularlos primero)
 *       500:
 *         description: Error al anular el participante
 */
export const anularEventoParticipanteHandler = async (req, res) => {
  try {
    const { eventoId, participanteId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventoId) || !mongoose.Types.ObjectId.isValid(participanteId)) {
      return res.status(400).json({ message: 'ID inválido' });
    }

    const participante = await EventoParticipante.findOne({ _id: participanteId, eventoId, clubId: req.user.clubId, active: true });
    if (!participante) return res.status(404).json({ message: 'Participante no encontrado' });
    if (participante.estado === 'anulada') return res.status(409).json({ message: 'El participante ya está anulado' });
    if (participante.pagos.length > 0) {
      return res.status(409).json({ message: 'Este participante tiene pagos registrados — anulalos primero antes de sacarlo del evento' });
    }

    const antes = participante.toObject();
    participante.estado = 'anulada';
    participante.active = false;
    participante.updatedBy = getActor(req);
    await participante.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'EventoParticipante', resourceId: participante._id, before: antes, after: null });
    return res.status(200).json({ message: 'Participante anulado' });
  } catch (error) {
    console.error('Error anulando el participante:', error);
    return res.status(500).json({ message: 'Error al anular el participante' });
  }
};

export default anularEventoParticipanteHandler;
