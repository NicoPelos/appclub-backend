import Rol from '../../roles/models/Rol.js';
import User from '../../usuarios/models/User.js';
import { invalidarClub } from '../../../services/permisosCache.js';

// Mismos protegidos que deleteRol.handler.js (club admin) — 'socio' y
// 'admin' son dependencias duras del código por slug (login/registro de
// socios, vinculación de tutores, único rol seedeado con roles:write), no
// solo una convención. Un superadmin borrándolos rompe el club exactamente
// igual que si lo hiciera un admin del club.
const SLUGS_PROTEGIDOS = ['socio', 'admin'];

/**
 * @openapi
 * /api/super/roles/{id}:
 *   delete:
 *     summary: Eliminar (desactivar) un rol de un club (superadmin, cualquier club)
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
 *         description: Rol eliminado
 *       404:
 *         description: Rol no encontrado
 *       409:
 *         description: El rol es uno protegido del sistema, o todavía tiene usuarios asignados
 */
export const deleteSuperRolHandler = async (req, res) => {
  try {
    const rol = await Rol.findOne({ _id: req.params.id, active: true });
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });

    // appcarc-superadmin#37: a diferencia del endpoint de club admin
    // (deleteRol.handler.js), este nunca chequeaba nada de esto — un
    // superadmin podía borrar 'socio'/'admin' de cualquier club, o
    // cualquier rol en uso, dejando a esos usuarios con roles: [] en
    // silencio (recrear un rol con el mismo nombre genera un _id nuevo que
    // los usuarios existentes no recuperan).
    if (SLUGS_PROTEGIDOS.includes(rol.slug)) {
      return res.status(409).json({ message: `El rol "${rol.nombre}" es un rol base del sistema y no se puede eliminar` });
    }
    const enUso = await User.exists({ clubId: rol.clubId, roles: rol._id });
    if (enUso) {
      return res.status(409).json({ message: 'El rol todavía tiene usuarios asignados' });
    }

    rol.active = false;
    await rol.save();

    invalidarClub(rol.clubId);
    res.status(200).json({ message: 'Rol eliminado' });
  } catch (error) {
    res.status(500).json({ message: 'Error eliminando rol' });
  }
};
