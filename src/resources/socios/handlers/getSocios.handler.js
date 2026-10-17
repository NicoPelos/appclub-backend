import Socio from '../models/Socio.js';

/**
 * @openapi
 * /api/socios:
 *   get:
 *     summary: Obtener lista de socios
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         description: "Número de página para paginación (default: 1)"
 *         required: false
 *         schema:
 *           type: integer
 *       - name: limit
 *         in: query
 *         description: "Cantidad de socios por página para paginación (default: 10, max: 50)"
 *         required: false
 *         schema:
 *           type: integer
 *       - name: trash
 *         in: query
 *         description: "Incluir socios eliminados (true/false, default: false)"
 *         required: false
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: Lista de socios obtenida exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 page:
 *                   type: integer
 *                   description: Número de página actual
 *                 limit:
 *                   type: integer
 *                   description: Cantidad de socios por página
 *                 total:
 *                   type: integer
 *                   description: Total de socios encontrados
 *                 totalPages:
 *                   type: integer
 *                   description: Total de páginas disponibles
 *                 socios:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Socio'
 *       500:
 *         description: Error al obtener socios
 */

export const getSociosHandler = async (req, res) => {
  try {
    const filter = { clubId: req.user?.clubId };
    filter.active = req.query.trash === 'true' ? false : true;

    if (typeof req.query.estado === 'string' && req.query.estado) {
      filter.estado = req.query.estado;
    }

    if (typeof req.query.search === 'string' && req.query.search) {
      const re = new RegExp(req.query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ nombre: re }, { apellido: re }, { dni: re }];
    }

    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const skip = (page - 1) * limit;

    const [total, socios] = await Promise.all([
      Socio.countDocuments(filter),
      Socio.find(filter).sort({ apellido: 1, nombre: 1 }).skip(skip).limit(limit),
    ]);

    res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      socios,
    });
  } catch (error) {
    console.error('Error obteniendo socios (handler):', error);
    res.status(500).json({ message: 'Error al obtener socios' });
  }
};

export default getSociosHandler;
