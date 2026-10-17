import RecursoExterno from '../models/RecursoExterno.js';

/**
 * @openapi
 * /api/recursos:
 *   get:
 *     summary: Listar recursos externos del club (topos de escalada, senderos de trekking)
 *     tags: [Recursos externos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: tipo
 *         in: query
 *         description: Filtrar por tipo
 *         schema: { type: string, enum: [topo, sendero] }
 *       - name: trash
 *         in: query
 *         description: Mostrar eliminados
 *         schema: { type: string, enum: ['true'] }
 *     responses:
 *       200:
 *         description: Lista de recursos, ordenados por provincia y orden
 *       500:
 *         description: Error al obtener recursos
 */
export const getRecursosHandler = async (req, res) => {
  try {
    const { tipo, trash } = req.query;
    const showTrash = trash === 'true';

    const filter = {
      clubId: req.user.clubId,
      active: !showTrash,
    };
    if (tipo) filter.tipo = tipo;

    const recursos = await RecursoExterno.find(filter).sort({ provincia: 1, orden: 1, nombre: 1 }).lean();
    return res.status(200).json(recursos);
  } catch (error) {
    console.error('Error obteniendo recursos:', error);
    return res.status(500).json({ message: 'Error al obtener recursos' });
  }
};

export default getRecursosHandler;
