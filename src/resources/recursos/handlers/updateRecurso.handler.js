import RecursoExterno from '../models/RecursoExterno.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const VALID_TIPOS = ['topo', 'sendero'];

/**
 * @openapi
 * /api/recursos/{id}:
 *   put:
 *     summary: Actualizar un recurso externo
 *     tags: [Recursos externos]
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
 *               tipo: { type: string, enum: [topo, sendero] }
 *               provincia: { type: string }
 *               nombre: { type: string }
 *               descripcion: { type: string }
 *               url: { type: string }
 *               urlProvincia: { type: string }
 *               orden: { type: number }
 *     responses:
 *       200:
 *         description: Recurso actualizado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Recurso no encontrado
 *       500:
 *         description: Error al actualizar recurso
 */
export const updateRecursoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { tipo, provincia, nombre, descripcion, url, urlProvincia, orden } = req.body;

    const recurso = await RecursoExterno.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!recurso) return res.status(404).json({ message: 'Recurso no encontrado' });
    const recursoAntes = recurso.toObject();

    if (tipo !== undefined) {
      if (!VALID_TIPOS.includes(tipo)) return res.status(400).json({ message: `tipo debe ser: ${VALID_TIPOS.join(', ')}` });
      recurso.tipo = tipo;
    }
    if (provincia !== undefined) recurso.provincia = provincia;
    if (nombre !== undefined) recurso.nombre = nombre;
    if (descripcion !== undefined) recurso.descripcion = descripcion;
    if (url !== undefined) recurso.url = url;
    if (urlProvincia !== undefined) recurso.urlProvincia = urlProvincia || null;
    if (orden !== undefined) recurso.orden = orden;

    recurso.updatedBy = getActor(req);
    await recurso.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'RecursoExterno', resourceId: recurso._id, before: recursoAntes, after: recurso.toObject() });
    return res.status(200).json(recurso);
  } catch (error) {
    console.error('Error actualizando recurso:', error);
    return res.status(500).json({ message: 'Error al actualizar recurso' });
  }
};

export default updateRecursoHandler;
