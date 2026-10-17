import Etiqueta from '../models/Etiqueta.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/etiquetas/{id}:
 *   put:
 *     summary: Actualizar etiqueta (solo admin)
 *     tags: [Etiquetas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre: { type: string }
 *               uso_sistema: { type: string }
 *     responses:
 *       200:
 *         description: Etiqueta actualizada
 *       404:
 *         description: Etiqueta no encontrada
 *       500:
 *         description: Error al actualizar etiqueta
 */
export const updateEtiquetaHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, uso_sistema } = req.body;

    const etiqueta = await Etiqueta.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!etiqueta) return res.status(404).json({ message: 'Etiqueta no encontrada' });
    const etiquetaAntes = etiqueta.toObject();

    if (nombre !== undefined) etiqueta.nombre = nombre;
    if (uso_sistema !== undefined) {
      const nuevoUsoSistema = uso_sistema || null;
      if (nuevoUsoSistema) {
        const existente = await Etiqueta.findOne({
          clubId: req.user.clubId, uso_sistema: nuevoUsoSistema, active: true, _id: { $ne: id },
        });
        if (existente) {
          return res.status(400).json({ message: `Ya existe otra etiqueta activa con uso_sistema "${nuevoUsoSistema}" en este club` });
        }
      }
      etiqueta.uso_sistema = nuevoUsoSistema;
    }

    etiqueta.updatedBy = getActor(req);
    await etiqueta.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Etiqueta', resourceId: etiqueta._id, before: etiquetaAntes, after: etiqueta.toObject() });
    return res.status(200).json(etiqueta);
  } catch (error) {
    console.error('Error actualizando etiqueta:', error);
    return res.status(500).json({ message: 'Error al actualizar etiqueta' });
  }
};

export default updateEtiquetaHandler;
