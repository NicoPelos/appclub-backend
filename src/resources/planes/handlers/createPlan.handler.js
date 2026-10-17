import Plan, { TIPOS, MODALIDADES } from '../models/Plan.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/planes:
 *   post:
 *     summary: Crear un nuevo plan
 *     tags: [Planes]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre, tipo, modalidad, etiquetaId]
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: Socio Activo
 *               tipo:
 *                 type: string
 *                 enum: [social, escuelita, muro_libre]
 *               modalidad:
 *                 type: string
 *                 enum: [mensual, por_uso]
 *               etiquetaId:
 *                 type: string
 *                 description: ID de la Etiqueta de precio asociada
 *               descripcion:
 *                 type: string
 *               atributos:
 *                 type: object
 *                 description: Datos flexibles (frecuenciaSemanal, requiereSocio, etc.)
 *                 example: { frecuenciaSemanal: 2, categoria: "Principiantes" }
 *               noGeneraDeuda:
 *                 type: boolean
 *                 description: Si es true, las suscripciones creadas con este plan no generan deuda (ej. Socio Honorario, Canje)
 *     responses:
 *       201:
 *         description: Plan creado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Etiqueta no encontrada
 *       409:
 *         description: Ya existe un plan con ese nombre
 *       500:
 *         description: Error al crear plan
 */
export const createPlanHandler = async (req, res) => {
  try {
    const { nombre, descripcion = '', tipo, modalidad, etiquetaId, atributos = {}, noGeneraDeuda = false } = req.body;

    if (!nombre) return res.status(400).json({ message: 'nombre es requerido' });
    if (!tipo || !TIPOS.includes(tipo)) return res.status(400).json({ message: `tipo debe ser: ${TIPOS.join(', ')}` });
    if (!modalidad || !MODALIDADES.includes(modalidad)) return res.status(400).json({ message: `modalidad debe ser: ${MODALIDADES.join(', ')}` });
    if (!etiquetaId) return res.status(400).json({ message: 'etiquetaId es requerido' });

    const etiqueta = await Etiqueta.findOne({ _id: etiquetaId, clubId: req.user.clubId, active: true });
    if (!etiqueta) return res.status(404).json({ message: 'Etiqueta no encontrada' });

    const plan = new Plan({
      clubId: req.user.clubId,
      nombre,
      descripcion,
      tipo,
      modalidad,
      etiquetaId,
      atributos,
      noGeneraDeuda: noGeneraDeuda === true,
      createdBy: getActor(req),
      updatedBy: getActor(req),
    });

    await plan.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Plan', resourceId: plan._id, before: null, after: plan.toObject() });
    return res.status(201).json(plan);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Ya existe un plan con ese nombre' });
    console.error('Error creando plan:', error);
    return res.status(500).json({ message: 'Error al crear plan' });
  }
};

export default createPlanHandler;
