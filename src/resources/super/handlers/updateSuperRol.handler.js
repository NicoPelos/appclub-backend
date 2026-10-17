import Rol from '../../roles/models/Rol.js';
import { TODOS_LOS_PERMISOS } from '../../../constants/permisos.js';
import { invalidarClub } from '../../../services/permisosCache.js';

/**
 * @openapi
 * /api/super/roles/{id}:
 *   patch:
 *     summary: Editar nombre y/o permisos de un rol (superadmin, cualquier club)
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Rol actualizado
 *       400:
 *         description: Permisos inválidos
 *       404:
 *         description: Rol no encontrado
 *       409:
 *         description: Ya existe otro rol con ese nombre en ese club
 */
export const updateSuperRolHandler = async (req, res) => {
  const { nombre, permisos } = req.body;

  if (permisos !== undefined && !Array.isArray(permisos)) {
    return res.status(400).json({ message: 'permisos debe ser un array' });
  }

  try {
    if (permisos !== undefined) {
      const invalidos = permisos.filter((p) => !TODOS_LOS_PERMISOS.includes(p));
      if (invalidos.length) return res.status(400).json({ message: `Permisos inválidos: ${invalidos.join(', ')}` });
    }

    const rol = await Rol.findOne({ _id: req.params.id, active: true });
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });

    if (nombre !== undefined && nombre !== rol.nombre) {
      const existe = await Rol.findOne({ clubId: rol.clubId, nombre, active: true, _id: { $ne: rol._id } });
      if (existe) return res.status(409).json({ message: `El rol '${nombre}' ya existe en ese club` });
      rol.nombre = nombre;
    }
    if (permisos !== undefined) rol.permisos = permisos;
    await rol.save();

    invalidarClub(rol.clubId);
    res.status(200).json(rol);
  } catch (error) {
    res.status(500).json({ message: 'Error actualizando rol' });
  }
};
