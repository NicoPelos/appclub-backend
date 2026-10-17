import Horarios from '../models/Horarios.js';
// Mismo criterio que create/update/deleteHorario.handler.js: solo
// admin/secretaria administran horarios de cualquiera, autoridad los ve
// todos en modo lectura, y el resto (profesor, palestrero, limpieza,
// arreglos) solo puede crear/editar los propios — por eso acá también
// deben ver solo los propios, no la planilla de horas del resto del staff.
import { ROLES_VER_TODO } from '../constants.js';

/**
 * @openapi
 * /api/horarios:
 *   get:
 *     summary: Obtener lista de horarios
 *     tags: [Horarios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 100 }
 *       - in: query
 *         name: nombre
 *         schema: { type: string }
 *       - in: query
 *         name: desde
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: hasta
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: trash
 *         schema: { type: boolean }
 *     responses:
 *       200:
 *         description: Lista de horarios obtenida exitosamente
 *       500:
 *         description: Error al obtener horarios
 */
export const getHorariosHandler = async (req, res) => {
  try {
    const { page = 1, limit = 20, trash, socioId, etiquetaId, desde, hasta } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = { clubId: req.user?.clubId, active: trash === 'true' ? false : true };

    const puedeVerTodo = req.user?.roles?.some(r => ROLES_VER_TODO.includes(r));
    if (!puedeVerTodo) {
      if (!req.user?.socioId) return res.status(200).json({ page: pageNumber, limit: pageSize, total: 0, totalPages: 0, horarios: [] });
      filter.socioId = req.user.socioId;
    } else if (socioId) {
      filter.socioId = socioId;
    }
    if (etiquetaId) filter.etiquetaId = etiquetaId;
    if (desde || hasta) {
      filter.fecha = {};
      if (desde) filter.fecha.$gte = new Date(desde);
      if (hasta) filter.fecha.$lte = new Date(hasta);
    }

    const [total, horarios] = await Promise.all([
      Horarios.countDocuments(filter),
      Horarios.find(filter)
        .populate('socioId', 'nombre apellido')
        .populate('etiquetaId', 'nombre unidad')
        .sort({ fecha: -1, horaEntrada: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize),
    ]);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      horarios,
    });
  } catch (error) {
    console.error('Error obteniendo horarios:', error);
    res.status(500).json({ message: 'Error al obtener horarios' });
  }
};
