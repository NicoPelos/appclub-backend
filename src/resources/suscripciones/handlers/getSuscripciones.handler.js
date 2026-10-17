import mongoose from 'mongoose';
import Suscripcion from '../models/Suscripcion.js';
import Plan from '../../planes/models/Plan.js';

const TIPOS_PLAN_VALIDOS = ['social', 'escuelita', 'muro_libre'];

/**
 * @openapi
 * /api/suscripciones:
 *   get:
 *     summary: Listar suscripciones del club (con filtros opcionales)
 *     tags: [Suscripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: socioId
 *         in: query
 *         schema: { type: string }
 *         description: Filtrar por socio (opcional)
 *       - name: planTipo
 *         in: query
 *         schema: { type: string, enum: [social, escuelita, muro_libre] }
 *         description: Filtrar por tipo de plan
 *       - name: activa
 *         in: query
 *         schema: { type: string, enum: ['true'] }
 *         description: Solo suscripciones activas (fechaHasta null)
 *     responses:
 *       200:
 *         description: Lista de suscripciones
 *       400:
 *         description: Parámetro inválido
 *       500:
 *         description: Error al obtener suscripciones
 */
export const getSuscripcionesHandler = async (req, res) => {
  try {
    const { socioId, activa, planTipo } = req.query;

    if (planTipo && !TIPOS_PLAN_VALIDOS.includes(planTipo)) {
      return res.status(400).json({ message: `planTipo inválido. Válidos: ${TIPOS_PLAN_VALIDOS.join(', ')}` });
    }

    if (socioId && !mongoose.isValidObjectId(socioId)) {
      return res.status(400).json({ message: 'socioId inválido' });
    }

    const filter = { clubId: req.user.clubId, active: true };

    if (socioId) filter.socioId = socioId;
    if (activa === 'true') filter.fechaHasta = null;

    if (planTipo) {
      const planes = await Plan.find({ clubId: req.user.clubId, tipo: planTipo, active: true })
        .select('_id').lean();
      filter.planId = { $in: planes.map((p) => p._id) };
    }

    const suscripciones = await Suscripcion
      .find(filter)
      .populate('planId', 'nombre tipo modalidad atributos')
      .populate('etiquetaId', 'nombre unidad')
      .sort({ fechaDesde: -1 })
      .lean();

    return res.status(200).json(suscripciones);
  } catch (error) {
    console.error('Error obteniendo suscripciones:', error);
    return res.status(500).json({ message: 'Error al obtener suscripciones' });
  }
};

