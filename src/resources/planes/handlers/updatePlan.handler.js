import Plan, { TIPOS, MODALIDADES } from '../models/Plan.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/planes/{id}:
 *   put:
 *     summary: Actualizar un plan existente
 *     tags: [Planes]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               tipo:
 *                 type: string
 *                 enum: [social, escuelita, muro_libre]
 *               modalidad:
 *                 type: string
 *                 enum: [mensual, por_uso]
 *               etiquetaId:
 *                 type: string
 *               descripcion:
 *                 type: string
 *               atributos:
 *                 type: object
 *               noGeneraDeuda:
 *                 type: boolean
 *                 description: Si es true, las suscripciones creadas con este plan no generan deuda (ej. Socio Honorario, Canje)
 *     responses:
 *       200:
 *         description: Plan actualizado
 *       400:
 *         description: tipo o modalidad inválido
 *       404:
 *         description: Plan o Etiqueta no encontrada
 *       409:
 *         description: Ya existe un plan con ese nombre
 *       500:
 *         description: Error al actualizar plan
 */
export const updatePlanHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, descripcion, tipo, modalidad, etiquetaId, atributos, noGeneraDeuda } = req.body;

    const plan = await Plan.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!plan) return res.status(404).json({ message: 'Plan no encontrado' });

    const planAntes = plan.toObject();

    if (nombre !== undefined) plan.nombre = nombre;
    if (descripcion !== undefined) plan.descripcion = descripcion;
    if (tipo !== undefined) {
      if (!TIPOS.includes(tipo)) return res.status(400).json({ message: `tipo debe ser: ${TIPOS.join(', ')}` });
      plan.tipo = tipo;
    }
    if (modalidad !== undefined) {
      if (!MODALIDADES.includes(modalidad)) return res.status(400).json({ message: `modalidad debe ser: ${MODALIDADES.join(', ')}` });
      plan.modalidad = modalidad;
    }
    if (etiquetaId !== undefined) {
      const etiqueta = await Etiqueta.findOne({ _id: etiquetaId, clubId: req.user.clubId, active: true });
      if (!etiqueta) return res.status(404).json({ message: 'Etiqueta no encontrada' });
      plan.etiquetaId = etiquetaId;
    }
    if (atributos !== undefined) plan.atributos = atributos;
    if (noGeneraDeuda !== undefined) plan.noGeneraDeuda = noGeneraDeuda === true;

    plan.updatedBy = getActor(req);
    await plan.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Plan', resourceId: plan._id, before: planAntes, after: plan.toObject() });
    return res.status(200).json(plan);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Ya existe un plan con ese nombre' });
    console.error('Error actualizando plan:', error);
    return res.status(500).json({ message: 'Error al actualizar plan' });
  }
};

export default updatePlanHandler;
