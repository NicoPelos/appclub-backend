import Precios from '../models/Precios.js';

/**
 * @openapi
 * /api/precios:
 *   get:
 *     summary: Listar precios históricos
 *     tags: [Precios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: etiquetaId
 *         in: query
 *         description: Filtrar por etiqueta
 *         schema: { type: string }
 *       - name: trash
 *         in: query
 *         description: Mostrar eliminados
 *         schema: { type: string, enum: ['true'] }
 *     responses:
 *       200:
 *         description: Lista de precios
 *       500:
 *         description: Error al obtener precios
 */
export const getPreciosHandler = async (req, res) => {
  try {
    const { etiquetaId, trash } = req.query;
    const showTrash = trash === 'true';

    const filter = {
      clubId: req.user.clubId,
      active: !showTrash,
    };

    if (etiquetaId) filter.etiquetaId = etiquetaId;

    const precios = await Precios.find(filter)
      .populate('etiquetaId', 'nombre unidad uso_sistema')
      .sort({ etiquetaId: 1, vigenteDesde: -1 })
      .lean();

    return res.status(200).json(precios);
  } catch (error) {
    console.error('Error obteniendo precios:', error);
    return res.status(500).json({ message: 'Error al obtener precios' });
  }
};

export default getPreciosHandler;
