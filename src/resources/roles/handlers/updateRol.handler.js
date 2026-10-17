import mongoose from 'mongoose';
import Rol from '../models/Rol.js';
import { TODOS_LOS_PERMISOS } from '../../../constants/permisos.js';
import { invalidarClub } from '../../../services/permisosCache.js';

/**
 * @openapi
 * /api/roles/{id}:
 *   put:
 *     summary: Editar nombre y/o permisos de un rol
 *     tags: [Roles]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               nombre:
 *                 type: string
 *               permisos:
 *                 type: array
 *                 items:
 *                   type: string
 *                 example: ["socios:read", "cobros:read"]
 *     responses:
 *       200:
 *         description: Rol actualizado
 *       400:
 *         description: Nombre vacío o permisos inválidos
 *       404:
 *         description: Rol no encontrado
 *       409:
 *         description: Ya existe otro rol con ese nombre
 *       500:
 *         description: Error al actualizar rol
 */
export const updateRolHandler = async (req, res) => {
  const { permisos } = req.body;
  const nombreRaw = req.body.nombre;

  // typeof + trim (appcarc-backend#226): !nombre no detecta un objeto (ej.
  // un operador $ne) — pasaba el chequeo y CastError-eaba recién al
  // asignarlo/guardar (-> 500). Espacios solos o "Admin " también pasaban,
  // ambiguos contra el índice único (sensible a mayúsculas/espacios).
  if (nombreRaw !== undefined && (typeof nombreRaw !== 'string' || !nombreRaw.trim())) {
    return res.status(400).json({ message: 'El campo nombre es requerido' });
  }
  const nombre = nombreRaw !== undefined ? nombreRaw.trim() : undefined;

  if (permisos !== undefined) {
    if (!Array.isArray(permisos)) return res.status(400).json({ message: 'permisos debe ser un array' });
    const invalidos = permisos.filter(p => !TODOS_LOS_PERMISOS.includes(p));
    if (invalidos.length) return res.status(400).json({ message: `Permisos inválidos: ${invalidos.join(', ')}` });
  }

  // :id con formato inválido dispara un CastError async sin capturar -> 500
  // en vez de 404 (appcarc-backend#227).
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(404).json({ message: 'Rol no encontrado' });
  }

  try {
    const rol = await Rol.findOne({ _id: req.params.id, clubId: req.user.clubId, active: true });
    if (!rol) return res.status(404).json({ message: 'Rol no encontrado' });

    if (nombre !== undefined && nombre !== rol.nombre) {
      const existe = await Rol.findOne({ clubId: req.user.clubId, nombre, active: true, _id: { $ne: rol._id } });
      if (existe) return res.status(409).json({ message: `El rol '${nombre}' ya existe` });
      rol.nombre = nombre;
    }
    if (permisos !== undefined) rol.permisos = permisos;
    await rol.save();

    invalidarClub(req.user.clubId);
    res.status(200).json(rol);
  } catch (error) {
    // El chequeo de arriba y el save() no son atómicos — dos renombres
    // simultáneos al mismo nombre pueden chocar con el índice único ->
    // E11000 (appcarc-backend#227).
    if (error.code === 11000) {
      return res.status(409).json({ message: `El rol '${nombre}' ya existe` });
    }
    res.status(500).json({ message: 'Error actualizando rol' });
  }
};
