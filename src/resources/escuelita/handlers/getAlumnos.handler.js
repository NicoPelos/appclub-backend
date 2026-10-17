import Escuelita from '../models/Escuelita.js';
import Socio from '../../socios/models/Socio.js';

/**
 * @openapi
 * /api/escuelita:
 *   get:
 *     summary: Obtener lista de alumnos de escuelita
 *     tags: [Escuelita]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           minimum: 1
 *         required: false
 *         description: Número de página
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *         required: false
 *         description: Cantidad de resultados por página
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         required: false
 *         description: Busca por nombre, apellido o DNI del socio inscripto
 *       - in: query
 *         name: planId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar por plan de escuelita
 *       - in: query
 *         name: trash
 *         schema:
 *           type: boolean
 *         required: false
 *         description: "Ver alumnos dados de baja en vez de los activos (default: false)"
 *     responses:
 *       200:
 *         description: Lista de alumnos de escuelita obtenida exitosamente
 *       500:
 *         description: Error al obtener alumnos de escuelita
 */

export const getAlumnosHandler = async (req, res) => {
  try {
    const { page = 1, limit = 20, socioId, search, planId, trash } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const filter = { clubId: req.user?.clubId, active: trash === 'true' ? false : true };

    if (socioId) {
      filter.socioId = socioId;
    }

    if (planId) {
      filter.planId = planId;
    }

    if (search && !socioId) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const socios = await Socio.find({ clubId: req.user?.clubId, $or: [{ nombre: re }, { apellido: re }, { dni: re }] }).select('_id');
      filter.socioId = { $in: socios.map((s) => s._id) };
    }

    const [total, alumnos] = await Promise.all([
      Escuelita.countDocuments(filter),
      Escuelita.find(filter)
        .populate('socioId', 'socioNumber nombre apellido dni correoElectronico telefono estado active')
        .populate('planId', 'nombre tipo modalidad atributos')
        .sort({ fechaInscripcion: -1, createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize),
    ]);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      alumnos,
    });
  } catch (error) {
    console.error('Error obteniendo alumnos de escuelita:', error);
    res.status(500).json({ message: 'Error al obtener alumnos de escuelita' });
  }
};

export default getAlumnosHandler;
