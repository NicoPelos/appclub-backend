import Rol from '../models/Rol.js';
import { TODOS_LOS_PERMISOS } from '../../../constants/permisos.js';
import { invalidarClub } from '../../../services/permisosCache.js';
import { generarSlugUnico } from '../services/slug.service.js';

/**
 * @openapi
 * /api/roles:
 *   post:
 *     summary: Crear un nuevo rol para el club
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [nombre]
 *             properties:
 *               nombre:
 *                 type: string
 *                 example: entrenador
 *               permisos:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["socios:read", "muroLibre:read"]
 *     responses:
 *       201:
 *         description: Rol creado
 *       400:
 *         description: Nombre requerido o permisos inválidos
 *       409:
 *         description: El rol ya existe
 *       500:
 *         description: Error al crear rol
 */
export const createRolHandler = async (req, res) => {
  const { permisos = [] } = req.body;
  // Sin validar tipo/trim, un body con nombre = objeto (ej. un operador
  // $ne) llega tal cual a Rol.findOne({ nombre, ... }) dando un 409 falso, y
  // "  " o "Admin " (con espacios) pasa igual — el índice único es sensible
  // a mayúsculas/espacios, así que "admin" y "Admin " conviven, ambiguos
  // para obtenerRolIdsPorNombres (appcarc-backend#226).
  if (typeof req.body.nombre !== 'string' || !req.body.nombre.trim()) {
    return res.status(400).json({ message: 'El campo nombre es requerido' });
  }
  const nombre = req.body.nombre.trim();

  if (!Array.isArray(permisos)) return res.status(400).json({ message: 'permisos debe ser un array' });

  const invalidos = permisos.filter(p => !TODOS_LOS_PERMISOS.includes(p));
  if (invalidos.length) return res.status(400).json({ message: `Permisos inválidos: ${invalidos.join(', ')}` });

  try {
    const existe = await Rol.findOne({ clubId: req.user.clubId, nombre, active: true });
    if (existe) return res.status(409).json({ message: `El rol '${nombre}' ya existe` });

    const slug = await generarSlugUnico({ clubId: req.user.clubId, nombre });
    const rol = new Rol({ clubId: req.user.clubId, nombre, slug, permisos });
    await rol.save();
    invalidarClub(req.user.clubId);
    res.status(201).json(rol);
  } catch (error) {
    // El chequeo de arriba (findOne) y el save() no son atómicos — dos POST
    // simultáneos con el mismo nombre pueden pasar ambos el chequeo y el
    // segundo save() choca con el índice único -> E11000 (appcarc-backend#227).
    if (error.code === 11000) {
      return res.status(409).json({ message: `El rol '${nombre}' ya existe` });
    }
    res.status(500).json({ message: 'Error creando rol' });
  }
};
