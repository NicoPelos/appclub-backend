import Evento from '../models/Evento.js';

/**
 * @openapi
 * /api/eventos:
 *   get:
 *     summary: Listar eventos del club
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: estado
 *         in: query
 *         schema: { type: string, enum: [abierto, cerrado] }
 *         description: Filtrar por estado
 *     responses:
 *       200:
 *         description: Lista de eventos, más recientes primero
 *       500:
 *         description: Error al obtener los eventos
 */
export const getEventosHandler = async (req, res) => {
  try {
    const { estado } = req.query;
    const filter = { clubId: req.user.clubId, active: true };
    if (estado) filter.estado = estado;

    const eventos = await Evento.find(filter).sort({ fecha: -1 }).lean();
    return res.status(200).json(eventos);
  } catch (error) {
    console.error('Error obteniendo eventos:', error);
    return res.status(500).json({ message: 'Error al obtener los eventos' });
  }
};

export default getEventosHandler;
