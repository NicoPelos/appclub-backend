import { promises as fs } from 'fs';
import path from 'path';
import Socio from '../models/Socio.js';
import { getActor } from '../../../services/getActor.js';

const FOTO_DIR = path.resolve('uploads/fotos');

/**
 * @openapi
 * /api/socios/{id}/foto:
 *   delete:
 *     summary: Quitar la foto de perfil subida (vuelve al avatar por defecto o la foto de Google)
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Foto quitada exitosamente
 *       403:
 *         description: Sin permiso para modificar este socio
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al quitar la foto
 */
export const deleteFotoSocioHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const socio = await Socio.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!socio) return res.status(404).json({ message: 'Socio no encontrado' });

    if (socio.fotoPerfil) {
      const filename = path.basename(socio.fotoPerfil);
      await fs.unlink(path.join(FOTO_DIR, filename)).catch(() => {});
    }

    socio.fotoPerfil = null;
    socio.updatedBy = getActor(req);
    await socio.save();

    return res.status(200).json({ message: 'Foto de perfil eliminada' });
  } catch (error) {
    console.error('Error eliminando foto de socio:', error);
    return res.status(500).json({ message: 'Error al eliminar la foto' });
  }
};
