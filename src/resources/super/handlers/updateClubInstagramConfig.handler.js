import Club from '../../clubs/models/Club.js';
import InstagramConfig from '../../novedades/models/InstagramConfig.js';

/**
 * @openapi
 * /super/clubs/{id}/instagram:
 *   put:
 *     summary: Crear o actualizar la configuración de Instagram de un club
 *     tags: [Super]
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
 *               igUserId: { type: string }
 *               username: { type: string }
 *               accessToken:
 *                 type: string
 *                 description: Write-only. Si se omite, se conserva el token ya guardado.
 *     responses:
 *       200:
 *         description: Configuración guardada (sin el access token)
 *       400:
 *         description: igUserId y accessToken son obligatorios para configurar por primera vez
 *       404:
 *         description: Club no encontrado
 */
export const updateClubInstagramConfigHandler = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id).lean();
    if (!club) return res.status(404).json({ message: 'Club no encontrado' });

    const { igUserId, username, accessToken } = req.body;

    const existing = await InstagramConfig.findOne({ clubId: club.slug });

    if (!existing && (!igUserId || !accessToken)) {
      return res.status(400).json({ message: 'igUserId y accessToken son obligatorios para configurar por primera vez' });
    }

    const update = {
      clubId: club.slug,
      updatedBy: req.user?.email || 'superadmin',
    };
    if (igUserId !== undefined) update.igUserId = igUserId;
    if (username !== undefined) update.username = username;
    if (accessToken) update.accessToken = accessToken; // solo se pisa si se mandó uno nuevo

    const saved = await InstagramConfig.findOneAndUpdate(
      { clubId: club.slug },
      { $set: update },
      { upsert: true, new: true, runValidators: true },
    ).select('-accessToken');

    res.status(200).json(saved);
  } catch (error) {
    console.error('Error guardando configuración de Instagram:', error);
    res.status(500).json({ message: 'Error al guardar configuración de Instagram' });
  }
};

