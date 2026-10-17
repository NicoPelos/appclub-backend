import Evento, { CATEGORIAS_EVENTO } from '../models/Evento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/eventos:
 *   post:
 *     summary: Crear un evento (viaje, curso, venta puntual, etc.)
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, categoria, fecha]
 *             properties:
 *               nombre:
 *                 type: string
 *               descripcion:
 *                 type: string
 *               categoria:
 *                 type: string
 *                 enum: [Viajes, Eventos, "Ventas / Reventa", "Subsidios / Donaciones", Otros]
 *               fecha:
 *                 type: string
 *                 format: date
 *               precioSugerido:
 *                 type: number
 *     responses:
 *       201:
 *         description: Evento creado
 *       400:
 *         description: Datos inválidos
 *       500:
 *         description: Error al crear el evento
 */
export const crearEventoHandler = async (req, res) => {
  try {
    const { nombre, descripcion = '', categoria, fecha, precioSugerido } = req.body;

    if (!String(nombre || '').trim()) return res.status(400).json({ message: 'nombre es requerido' });
    if (!CATEGORIAS_EVENTO.includes(categoria)) {
      return res.status(400).json({ message: `categoria debe ser una de: ${CATEGORIAS_EVENTO.join(', ')}` });
    }
    const fechaEvento = fecha ? new Date(fecha) : null;
    if (!fechaEvento || Number.isNaN(fechaEvento.getTime())) return res.status(400).json({ message: 'fecha es requerida y debe ser válida' });

    if (precioSugerido !== undefined && precioSugerido !== null) {
      const monto = Number(precioSugerido);
      if (!Number.isFinite(monto) || monto < 0) return res.status(400).json({ message: 'precioSugerido debe ser un número mayor o igual a cero' });
    }

    const actor = getActor(req);
    const evento = new Evento({
      clubId: req.user.clubId,
      nombre: nombre.trim(),
      descripcion,
      categoria,
      fecha: fechaEvento,
      precioSugerido: precioSugerido == null ? null : Number(precioSugerido),
      createdBy: actor,
      updatedBy: actor,
    });

    await evento.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Evento', resourceId: evento._id, before: null, after: evento.toObject() });
    return res.status(201).json(evento);
  } catch (error) {
    console.error('Error creando evento:', error);
    return res.status(500).json({ message: 'Error al crear el evento' });
  }
};

export default crearEventoHandler;
