import CargoPuntual from '../models/CargoPuntual.js';

/**
 * @openapi
 * /api/cargos-puntuales:
 *   get:
 *     summary: Listar cargos puntuales
 *     tags: [CargosPuntuales]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: socioId
 *         schema:
 *           type: string
 *       - in: query
 *         name: estado
 *         schema:
 *           type: string
 *           enum: [pendiente, pagada, anulada]
 *     responses:
 *       200:
 *         description: Lista de cargos puntuales
 */
export const getCargosPuntualesHandler = async (req, res) => {
  try {
    const filter = { clubId: req.user?.clubId, active: true };

    if (req.accessibleSocioIds) {
      // Autoservicio (ver authorizeSelfYVinculadosOr): propio perfil + hijos vinculados.
      filter.socioId = { $in: [...req.accessibleSocioIds] };
    } else if (req.query.socioId) {
      filter.socioId = req.query.socioId;
    }

    if (req.query.estado) {
      filter.estado = req.query.estado;
    }

    const cargos = await CargoPuntual.find(filter)
      .sort({ createdAt: -1 })
      .populate('socioId', 'socioNumber nombre apellido dni')
      .populate('etiquetaId', 'nombre');

    return res.status(200).json({ cargos });
  } catch (error) {
    console.error('Error obteniendo cargos puntuales:', error);
    return res.status(500).json({ message: 'Error al obtener cargos puntuales' });
  }
};

export default getCargosPuntualesHandler;
