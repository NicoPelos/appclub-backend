import Novedad from '../models/Novedad.js';

/**
 * @openapi
 * /api/novedades:
 *   get:
 *     summary: Listar novedades del club
 *     tags: [Novedades]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 20 }
 *       - in: query
 *         name: fuente
 *         schema: { type: string, enum: [instagram, manual] }
 *         description: Filtrar por origen
 *       - in: query
 *         name: categoria
 *         schema: { type: string }
 *         description: Filtrar por categoría
 *     responses:
 *       200:
 *         description: Lista paginada de novedades
 *       500:
 *         description: Error al obtener novedades
 */
export const getNovedadesHandler = async (req, res) => {
  try {
    const { page = 1, limit = 20, fuente, categoria } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const filter = { clubId: req.user?.clubId, active: true };
    if (fuente) filter.fuente = fuente;
    if (categoria) filter.categoria = categoria;

    const [total, novedades] = await Promise.all([
      Novedad.countDocuments(filter),
      Novedad.find(filter)
        .sort({ fechaPublicacion: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      novedades,
    });
  } catch (error) {
    console.error('Error obteniendo novedades:', error);
    res.status(500).json({ message: 'Error al obtener novedades' });
  }
};
