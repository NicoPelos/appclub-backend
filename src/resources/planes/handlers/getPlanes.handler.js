import Plan from '../models/Plan.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';

/**
 * @openapi
 * /api/planes:
 *   get:
 *     summary: Listar planes del club
 *     tags: [Planes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: tipo
 *         in: query
 *         schema:
 *           type: string
 *           enum: [social, escuelita, muro_libre]
 *         description: Filtrar por tipo de plan
 *       - name: trash
 *         in: query
 *         schema:
 *           type: string
 *           enum: ['true']
 *         description: Mostrar planes eliminados
 *     responses:
 *       200:
 *         description: Lista de planes con etiquetaId populado y suscripcionesActivas por plan
 *       500:
 *         description: Error al obtener planes
 */
export const getPlanesHandler = async (req, res) => {
  try {
    const { tipo, trash } = req.query;
    const showTrash = trash === 'true';

    const filter = { clubId: req.user.clubId, active: !showTrash };
    if (tipo) filter.tipo = tipo;

    const planes = await Plan.find(filter)
      .populate('etiquetaId', 'nombre unidad')
      .sort({ tipo: 1, nombre: 1 })
      .lean();

    // Mismo criterio que deletePlan.handler.js usa para bloquear el borrado:
    // así el staff ve, antes de tocar nada, cuántas suscripciones dependen de
    // cada plan (esto habría hecho evidente el cruce de planes de dos alumnos,
    // ver appcarc-backend#12).
    const conteos = await Suscripcion.aggregate([
      { $match: { clubId: req.user.clubId, active: true, fechaHasta: null, planId: { $in: planes.map((p) => p._id) } } },
      { $group: { _id: '$planId', count: { $sum: 1 } } },
    ]);
    const conteoPorPlan = new Map(conteos.map((c) => [String(c._id), c.count]));
    const planesConConteo = planes.map((p) => ({
      ...p,
      suscripcionesActivas: conteoPorPlan.get(String(p._id)) ?? 0,
    }));

    return res.status(200).json(planesConConteo);
  } catch (error) {
    console.error('Error obteniendo planes:', error);
    return res.status(500).json({ message: 'Error al obtener planes' });
  }
};

export default getPlanesHandler;
