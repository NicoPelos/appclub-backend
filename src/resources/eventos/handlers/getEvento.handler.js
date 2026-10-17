import mongoose from 'mongoose';
import Evento from '../models/Evento.js';

/**
 * @openapi
 * /api/eventos/{id}:
 *   get:
 *     summary: Detalle de un evento
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Evento encontrado
 *       404:
 *         description: Evento no encontrado
 *       500:
 *         description: Error al obtener el evento
 */
export const getEventoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID de evento inválido' });

    const evento = await Evento.findOne({ _id: id, clubId: req.user.clubId, active: true }).lean();
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });
    return res.status(200).json(evento);
  } catch (error) {
    console.error('Error obteniendo el evento:', error);
    return res.status(500).json({ message: 'Error al obtener el evento' });
  }
};

export default getEventoHandler;
