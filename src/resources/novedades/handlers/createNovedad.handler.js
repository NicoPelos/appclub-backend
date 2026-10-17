import Novedad from '../models/Novedad.js';
import { notifyClub } from '../../../services/pushNotification.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/novedades:
 *   post:
 *     summary: Crear una novedad manual
 *     tags: [Novedades]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [titulo]
 *             properties:
 *               titulo:
 *                 type: string
 *               cuerpo:
 *                 type: string
 *               imagenUrl:
 *                 type: string
 *               linkOriginal:
 *                 type: string
 *               categoria:
 *                 type: string
 *               fechaPublicacion:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       201:
 *         description: Novedad creada exitosamente
 *       400:
 *         description: Título obligatorio
 *       500:
 *         description: Error al crear novedad
 */
export const createNovedadHandler = async (req, res) => {
  try {
    const { titulo, cuerpo, imagenUrl, linkOriginal, categoria, fechaPublicacion } = req.body;

    if (!titulo?.trim()) {
      return res.status(400).json({ message: 'El título es obligatorio' });
    }

    const novedad = new Novedad({
      clubId: req.user?.clubId,
      fuente: 'manual',
      titulo: titulo.trim(),
      cuerpo: cuerpo?.trim() || '',
      imagenUrl: imagenUrl || null,
      linkOriginal: linkOriginal || null,
      categoria: categoria?.trim() || '',
      fechaPublicacion: fechaPublicacion ? new Date(fechaPublicacion) : new Date(),
      createdBy: getActor(req),
    });

    await novedad.save();

    // Push en background — no bloquea la respuesta
    notifyClub(req.user?.clubId, {
      title: novedad.titulo,
      body: novedad.cuerpo?.slice(0, 100) || 'Nueva novedad del club',
      data: { novedadId: String(novedad._id), tipo: 'novedad', url: 'carc://(tabs)/comunidad' },
    }).catch((err) => console.error('Error enviando push de novedad:', err));

    res.status(201).json(novedad);
  } catch (error) {
    console.error('Error creando novedad:', error);
    res.status(500).json({ message: 'Error al crear novedad' });
  }
};
