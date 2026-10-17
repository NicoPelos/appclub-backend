import { PERMISOS_POR_CATEGORIA } from '../../../constants/permisos.js';

/**
 * @openapi
 * /api/super/permisos:
 *   get:
 *     summary: Catálogo de permisos agrupados por categoría (para armar el formulario de rol)
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de categorías con sus permisos
 */
export const getPermisosCatalogoHandler = async (req, res) => {
  res.status(200).json(PERMISOS_POR_CATEGORIA);
};
