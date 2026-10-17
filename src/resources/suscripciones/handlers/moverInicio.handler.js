import Suscripcion from '../models/Suscripcion.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { PERIODO_PATTERN } from '../../../services/periodos.js';
import { getActor } from '../../../services/getActor.js';


/**
 * @openapi
 * /api/suscripciones/{id}/mover-inicio:
 *   put:
 *     summary: Adelantar la fecha de inicio de una suscripción (ej. se asignó el plan tarde y en realidad el socio ya venía desde antes)
 *     tags: [Suscripciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fechaDesde]
 *             properties:
 *               fechaDesde:
 *                 type: string
 *                 example: "2026-04"
 *                 description: Nueva fecha de inicio (debe ser anterior a la actual), formato YYYY-MM
 *     responses:
 *       200:
 *         description: Fecha de inicio actualizada
 *       400:
 *         description: Datos inválidos o la nueva fecha no es anterior a la actual
 *       404:
 *         description: Suscripción no encontrada
 *       409:
 *         description: Ya existe otra suscripción activa que cubre parte de ese rango
 *       500:
 *         description: Error al mover la fecha de inicio
 */
export const moverInicioHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { fechaDesde } = req.body;

    if (!fechaDesde || !PERIODO_PATTERN.test(fechaDesde)) {
      return res.status(400).json({ message: 'fechaDesde debe tener formato YYYY-MM' });
    }

    const suscripcion = await Suscripcion.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!suscripcion) {
      return res.status(404).json({ message: 'Suscripción no encontrada' });
    }

    if (fechaDesde >= suscripcion.fechaDesde) {
      return res.status(400).json({ message: 'La nueva fecha debe ser anterior a la fecha de inicio actual' });
    }

    // No dejar que el nuevo rango pise otra suscripción activa de la misma
    // etiqueta que ya cubre parte de esos meses (evita duplicar deuda).
    const solapada = await Suscripcion.findOne({
      clubId: req.user.clubId,
      socioId: suscripcion.socioId,
      etiquetaId: suscripcion.etiquetaId,
      _id: { $ne: suscripcion._id },
      active: true,
      fechaDesde: { $lt: suscripcion.fechaDesde },
      $or: [{ fechaHasta: null }, { fechaHasta: { $gte: fechaDesde } }],
    });
    if (solapada) {
      return res.status(409).json({ message: 'Ya existe otra suscripción activa que cubre parte de ese rango' });
    }

    const suscripcionAntes = suscripcion.toObject();
    suscripcion.fechaDesde = fechaDesde;
    suscripcion.updatedBy = getActor(req);
    await suscripcion.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: suscripcion._id, before: suscripcionAntes, after: suscripcion.toObject() });
    return res.status(200).json(suscripcion);
  } catch (error) {
    console.error('Error moviendo fecha de inicio de suscripción:', error);
    return res.status(500).json({ message: 'Error al mover la fecha de inicio' });
  }
};

