import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import Movimiento from '../models/Movimiento.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { createUploadImagen } from '../../../middleware/uploadImagen.js';
import { getActor } from '../../../services/getActor.js';

const COMPROBANTES_DIR = path.resolve('uploads/comprobantes');
// Mismo criterio que fotos/ de Socio — el volumen de /uploads es un bind
// mount persistente en el host, no hay garantía de que la subcarpeta exista.
fs.mkdirSync(COMPROBANTES_DIR, { recursive: true });

const MAX_SIZE_MB = 20;

export const { upload, handleUploadError } = createUploadImagen(MAX_SIZE_MB);

/**
 * @openapi
 * /api/movimientos/{id}/comprobantes:
 *   post:
 *     summary: Agregar una foto de comprobante/ticket a un movimiento (siempre opcional, se pueden subir varias)
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               foto: { type: string, format: binary }
 *     responses:
 *       201:
 *         description: Comprobante agregado
 *       400:
 *         description: No se recibió ninguna imagen
 *       404:
 *         description: Movimiento no encontrado
 */
export const uploadComprobanteHandler = async (req, res) => {
  try {
    const { id } = req.params;
    if (!req.file) {
      return res.status(400).json({ message: 'No se recibió ninguna imagen' });
    }

    const movimiento = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!movimiento) return res.status(404).json({ message: 'Movimiento no encontrado' });

    // A diferencia de la foto de perfil de Socio, acá NO se recorta cuadrado
    // — un ticket es rectangular y hay que poder leer el texto. Solo se pone
    // un techo de resolución para no guardar fotos de cámara de varios MB.
    const buffer = await sharp(req.file.buffer)
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const actor = getActor(req);
    movimiento.comprobantes.push({ url: '', createdBy: actor });
    const nuevo = movimiento.comprobantes[movimiento.comprobantes.length - 1];

    const filename = `comprobante_${nuevo._id}.jpg`;
    fs.writeFileSync(path.join(COMPROBANTES_DIR, filename), buffer);
    nuevo.url = `/uploads/comprobantes/${filename}`;
    movimiento.updatedBy = actor;
    await movimiento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before: null, after: { comprobanteAgregado: nuevo.url } });
    res.status(201).json(nuevo);
  } catch (error) {
    console.error('Error subiendo comprobante:', error);
    res.status(500).json({ message: 'Error al subir el comprobante' });
  }
};

export default uploadComprobanteHandler;
