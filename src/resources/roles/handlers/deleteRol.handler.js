import mongoose from 'mongoose';
import Rol from '../models/Rol.js';
import User from '../../usuarios/models/User.js';
import { invalidarClub } from '../../../services/permisosCache.js';

// 'socio' es una dependencia dura del código, no solo una convención: el
// registro/login de socios y la vinculación de tutores resuelven este slug
// a mano (ver obtenerRolIdsPorSlugs({ slugs: ['socio'] }) en auth.handler.js,
// userSync.js y crearVinculoFamiliar.service.js). 'admin' es el único rol
// seedeado con permiso de administrar roles (roles:write) — borrarlo deja al
// club sin nadie que pueda recrearlo o gestionar el resto.
const SLUGS_PROTEGIDOS = ['socio', 'admin'];

/**
 * @openapi
 * /api/roles/{id}:
 *   delete:
 *     summary: Eliminar (desactivar) un rol del club
 *     tags: [Roles]
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
 *       500:
 *         description: Error al eliminar rol
 */
export const deleteRolHandler = async (req, res) => {
  try {
    // :id con formato inválido dispara un CastError async sin capturar ->
    // 500 en vez de 404 (appcarc-backend#227).
    if (!mongoose.isValidObjectId(req.params.id)) {
      return res.status(404).json({ message: 'Rol no encontrado' });
    }
    const rol = await Rol.findOne({ _id: req.params.id, clubId: req.user.clubId, active: true });
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });

    // appcarc-backend#225: sin este chequeo, borrar un rol en uso (o uno de
    // los que el código depende por slug) dejaba a esos usuarios con
    // `roles: []` — recrear un rol con el mismo nombre genera un _id nuevo,
    // así que los usuarios existentes (apuntan al _id viejo) no lo recuperan.
    if (SLUGS_PROTEGIDOS.includes(rol.slug)) {
      return res.status(409).json({ message: `El rol "${rol.nombre}" es un rol base del sistema y no se puede eliminar` });
    }
    const enUso = await User.exists({ clubId: req.user.clubId, roles: rol._id });
    if (enUso) {
      return res.status(409).json({ message: 'El rol todavía tiene usuarios asignados' });
    }

    rol.active = false;
    await rol.save();

    invalidarClub(req.user.clubId);
    res.status(200).json({ message: 'Rol eliminado' });
  } catch (error) {
    res.status(500).json({ message: 'Error eliminando rol' });
  }
};
