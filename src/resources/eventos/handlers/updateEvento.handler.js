import mongoose from 'mongoose';
import Evento, { CATEGORIAS_EVENTO } from '../models/Evento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/eventos/{id}:
 *   put:
 *     summary: Editar un evento (nombre, descripción, categoría, fecha, precio sugerido)
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre: { type: string }
 *               descripcion: { type: string }
 *               categoria: { type: string }
 *               fecha: { type: string, format: date }
 *               precioSugerido: { type: number }
 *     responses:
 *       200:
 *         description: Evento actualizado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Evento no encontrado
 *       500:
 *         description: Error al actualizar el evento
 */
export const updateEventoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ message: 'ID de evento inválido' });

    const evento = await Evento.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });

    const { nombre, descripcion, categoria, fecha, precioSugerido } = req.body;
    const eventoAntes = evento.toObject();

    if (nombre !== undefined) {
      if (!String(nombre).trim()) return res.status(400).json({ message: 'nombre no puede quedar vacío' });
      evento.nombre = nombre.trim();
    }
    if (descripcion !== undefined) evento.descripcion = descripcion;
    if (categoria !== undefined) {
      if (!CATEGORIAS_EVENTO.includes(categoria)) {
        return res.status(400).json({ message: `categoria debe ser una de: ${CATEGORIAS_EVENTO.join(', ')}` });
      }
      evento.categoria = categoria;
    }
    if (fecha !== undefined) {
      const fechaEvento = new Date(fecha);
      if (Number.isNaN(fechaEvento.getTime())) return res.status(400).json({ message: 'fecha inválida' });
      evento.fecha = fechaEvento;
    }
    if (precioSugerido !== undefined) {
      if (precioSugerido === null) {
        evento.precioSugerido = null;
      } else {
        const monto = Number(precioSugerido);
        if (!Number.isFinite(monto) || monto < 0) return res.status(400).json({ message: 'precioSugerido debe ser un número mayor o igual a cero' });
        evento.precioSugerido = monto;
      }
    }

    evento.updatedBy = getActor(req);
    await evento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Evento', resourceId: evento._id, before: eventoAntes, after: evento.toObject() });
    return res.status(200).json(evento);
  } catch (error) {
    console.error('Error actualizando el evento:', error);
    return res.status(500).json({ message: 'Error al actualizar el evento' });
  }
};

export default updateEventoHandler;
