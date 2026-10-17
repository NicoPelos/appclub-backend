import Rol from '../../roles/models/Rol.js';

/**
 * @openapi
 * /api/super/roles:
 *   get:
 *     summary: Listar roles activos de un club (superadmin, cualquier club)
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: clubId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lista de roles activos del club
 *       400:
 *         description: Falta clubId
 */
export const getSuperRolesHandler = async (req, res) => {
  const { clubId } = req.query;
  if (!clubId) return res.status(400).json({ message: 'clubId es requerido' });

  try {
    const roles = await Rol.find({ clubId, active: true }).sort({ nombre: 1 }).lean();
    res.status(200).json(roles);
  } catch (error) {
    res.status(500).json({ message: 'Error obteniendo roles' });
  }
};
