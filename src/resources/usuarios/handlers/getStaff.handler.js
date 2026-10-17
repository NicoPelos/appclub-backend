import User from '../models/User.js';
import { obtenerRolIdsPorSlugs } from '../../roles/services/resolverRoles.service.js';

const ROLES_STAFF = ['profesor', 'palestrero', 'limpieza', 'arreglos', 'colaborador', 'admin', 'secretaria'];

/**
 * @openapi
 * /api/usuarios/staff:
 *   get:
 *     summary: Obtener lista de usuarios con roles de staff
 *     tags: [Usuarios]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de staff agrupada por rol
 */
export const getStaffHandler = async (req, res) => {
  try {
    const rolIds = await obtenerRolIdsPorSlugs({ clubId: req.user.clubId, slugs: ROLES_STAFF });
    const users = await User.find({
      clubId: req.user.clubId,
      active: true,
      roles: { $in: rolIds },
    })
      .select('nombre email roles socioId')
      .populate('roles', 'slug')
      .sort({ nombre: 1 })
      .lean();

    const staff = users.map((u) => ({ ...u, roles: u.roles.map((r) => r.slug) }));
    res.status(200).json(staff);
  } catch (error) {
    console.error('Error obteniendo staff:', error);
    res.status(500).json({ message: 'Error al obtener staff' });
  }
};
