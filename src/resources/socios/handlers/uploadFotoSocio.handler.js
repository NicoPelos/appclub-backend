import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import Socio from '../models/Socio.js';
import { createUploadImagen } from '../../../middleware/uploadImagen.js';
import { getActor } from '../../../services/getActor.js';

const FOTO_DIR = path.resolve('uploads/fotos');
// El volumen de /uploads es un bind mount persistente en el host — nada
// garantiza que la subcarpeta fotos/ exista de antemano (nunca se creó en
// producción, lo que rompía toda subida de foto con "unable to open for
// write"). La creamos al levantar el server para que sea auto-reparable.
fs.mkdirSync(FOTO_DIR, { recursive: true });
// La imagen se re-comprime a 256x256 en el servidor (ver abajo), así que el
// límite acá es solo un techo de transporte, no de almacenamiento — lo
// suficientemente alto para no rechazar fotos de cámara normales (con
// quality: 0.7 desde el picker del mobile, igual pueden pesar varios MB).
const MAX_SIZE_MB = 20;

export const { upload, handleUploadError } = createUploadImagen(MAX_SIZE_MB);

/**
 * @openapi
 * /api/socios/{id}/foto:
 *   put:
 *     summary: Subir o reemplazar foto de perfil del socio
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               foto:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: URL de la foto guardada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 fotoPerfil: { type: string }
 *       400:
 *         description: No se recibió imagen
 *       403:
 *         description: Sin permiso para modificar este socio
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al subir foto
 */
export const uploadFotoSocioHandler = async (req, res) => {
  try {
    const { id } = req.params;

    const soloSocio = req.user.roles?.length > 0 && req.user.roles.every((r) => r === 'socio');
    if (soloSocio && req.user.socioId !== id) {
      return res.status(403).json({ message: 'No tenés permiso para modificar este socio' });
    }

    const socio = await Socio.findOne({ _id: id, clubId: req.user.clubId, active: true });
    if (!socio) return res.status(404).json({ message: 'Socio no encontrado' });

    if (!req.file) return res.status(400).json({ message: 'No se recibió ninguna imagen' });

    const filename = `socio_${id}.jpg`;
    const filepath = path.join(FOTO_DIR, filename);

    await sharp(req.file.buffer)
      .resize(256, 256, { fit: 'cover', position: 'center' })
      .jpeg({ quality: 80 })
      .toFile(filepath);

    socio.fotoPerfil = `/uploads/fotos/${filename}`;
    socio.updatedBy = getActor(req);
    await socio.save();

    return res.status(200).json({ fotoPerfil: socio.fotoPerfil });
  } catch (error) {
    console.error('Error subiendo foto de socio:', error);
    return res.status(500).json({ message: 'Error al subir foto' });
  }
};
