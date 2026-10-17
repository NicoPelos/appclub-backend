import Rol from '../../roles/models/Rol.js';
import { TODOS_LOS_PERMISOS } from '../../../constants/permisos.js';
import { invalidarClub } from '../../../services/permisosCache.js';
import { generarSlugUnico } from '../../roles/services/slug.service.js';

/**
 * @openapi
 * /api/super/roles:
 *   post:
 *     summary: Crear un rol para un club (superadmin, cualquier club)
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clubId, nombre]
 *             properties:
 *               clubId: { type: string }
 *               nombre: { type: string }
 *               permisos:
 *                 type: array
 *                 items: { type: string }
 *     responses:
 *       201:
 *         description: Rol creado
 *       400:
 *         description: Faltan campos o permisos inválidos
 *       409:
 *         description: El rol ya existe en ese club
 */
export const createSuperRolHandler = async (req, res) => {
  const { clubId, nombre, permisos = [] } = req.body;
  if (!clubId || !nombre) return res.status(400).json({ message: 'clubId y nombre son requeridos' });
  if (!Array.isArray(permisos)) return res.status(400).json({ message: 'permisos debe ser un array' });

  try {
    const invalidos = permisos.filter((p) => !TODOS_LOS_PERMISOS.includes(p));
    if (invalidos.length) return res.status(400).json({ message: `Permisos inválidos: ${invalidos.join(', ')}` });

    const existe = await Rol.findOne({ clubId, nombre, active: true });
    if (existe) return res.status(409).json({ message: `El rol '${nombre}' ya existe en ese club` });

    const slug = await generarSlugUnico({ clubId, nombre });
    const rol = new Rol({ clubId, nombre, slug, permisos });
    await rol.save();
    invalidarClub(clubId);
    res.status(201).json(rol);
  } catch (error) {
    res.status(500).json({ message: 'Error creando rol' });
  }
};
