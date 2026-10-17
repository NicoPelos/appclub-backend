import Rol from '../models/Rol.js';

/**
 * @openapi
 * /api/roles:
 *   get:
 *     summary: Listar roles del club con sus permisos
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de roles activos
 *       500:
 *         description: Error al obtener roles
 */
export const getRolesHandler = async (req, res) => {
  try {
    const roles = await Rol.find({ clubId: req.user.clubId, active: true }).sort({ nombre: 1 }).lean();
    res.status(200).json(roles);
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo roles' });
  }
};
