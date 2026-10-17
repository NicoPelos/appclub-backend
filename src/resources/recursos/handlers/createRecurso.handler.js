import RecursoExterno from '../models/RecursoExterno.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const VALID_TIPOS = ['topo', 'sendero'];

/**
 * @openapi
 * /api/recursos:
 *   post:
 *     summary: Crear un recurso externo (topo o sendero)
 *     tags: [Recursos externos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tipo, provincia, nombre, url]
 *             properties:
 *               tipo: { type: string, enum: [topo, sendero] }
 *               provincia: { type: string }
 *               nombre: { type: string }
 *               descripcion: { type: string }
 *               url: { type: string }
 *               urlProvincia: { type: string }
 *               orden: { type: number }
 *     responses:
 *       201:
 *         description: Recurso creado
 *       400:
 *         description: Datos inválidos
 *       500:
 *         description: Error al crear recurso
 */
export const createRecursoHandler = async (req, res) => {
  try {
    const { tipo, provincia, nombre, descripcion, url, urlProvincia, orden } = req.body;

    if (!tipo || !VALID_TIPOS.includes(tipo)) {
      return res.status(400).json({ message: `tipo debe ser: ${VALID_TIPOS.join(', ')}` });
    }
    if (!provincia) return res.status(400).json({ message: 'provincia es requerida' });
    if (!nombre) return res.status(400).json({ message: 'nombre es requerido' });
    if (!url) return res.status(400).json({ message: 'url es requerida' });

    const recurso = new RecursoExterno({
      clubId: req.user.clubId,
      tipo,
      provincia,
      nombre,
      descripcion: descripcion || '',
      url,
      urlProvincia: urlProvincia || null,
      orden: orden ?? 0,
      createdBy: getActor(req),
      updatedBy: getActor(req),
    });

    await recurso.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'RecursoExterno', resourceId: recurso._id, before: null, after: recurso.toObject() });
    return res.status(201).json(recurso);
  } catch (error) {
    console.error('Error creando recurso:', error);
    return res.status(500).json({ message: 'Error al crear recurso' });
  }
};

export default createRecursoHandler;
