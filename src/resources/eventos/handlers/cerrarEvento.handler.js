import mongoose from 'mongoose';
import Evento from '../models/Evento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/eventos/{id}/cerrar:
 *   post:
 *     summary: Cerrar un evento (no admite más participantes ni pagos, sigue visible)
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
 *         description: Evento cerrado
 *       404:
 *         description: Evento no encontrado
 *       409:
 *         description: El evento ya está cerrado
 *       500:
 *         description: Error al cerrar el evento
 */
export const cerrarEventoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID de evento inválido' });

    const evento = await Evento.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });
    if (evento.estado === 'cerrado') return res.status(409).json({ message: 'El evento ya está cerrado' });

    const eventoAntes = evento.toObject();
    evento.estado = 'cerrado';
    evento.updatedBy = getActor(req);
    await evento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Evento', resourceId: evento._id, before: eventoAntes, after: evento.toObject() });
    return res.status(200).json(evento);
  } catch (error) {
    console.error('Error cerrando el evento:', error);
    return res.status(500).json({ message: 'Error al cerrar el evento' });
  }
};

export default cerrarEventoHandler;
