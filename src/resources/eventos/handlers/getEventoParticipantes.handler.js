import mongoose from 'mongoose';
import Evento from '../models/Evento.js';
import EventoParticipante from '../models/EventoParticipante.js';

/**
 * @openapi
 * /api/eventos/{eventoId}/participantes:
 *   get:
 *     summary: Listar el roster de un evento con el estado de pago de cada participante
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventoId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lista de participantes, ordenados por apellido/nombre
 *       404:
 *         description: Evento no encontrado
 *       500:
 *         description: Error al obtener los participantes
 */
export const getEventoParticipantesHandler = async (req, res) => {
  try {
    const { eventoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventoId)) return res.status(400).json({ message: 'ID de evento inválido' });

    const evento = await Evento.findOne({ _id: eventoId, clubId: req.user.clubId, active: true }).lean();
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });

    const participantes = await EventoParticipante.find({ eventoId, active: true })
      .sort({ apellido: 1, nombre: 1 })
      .lean();

    return res.status(200).json(participantes);
  } catch (error) {
    console.error('Error obteniendo los participantes del evento:', error);
    return res.status(500).json({ message: 'Error al obtener los participantes' });
  }
};

export default getEventoParticipantesHandler;
