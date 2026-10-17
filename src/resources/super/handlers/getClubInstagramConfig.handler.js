import Club from '../../clubs/models/Club.js';
import InstagramConfig from '../../novedades/models/InstagramConfig.js';

/**
 * @openapi
 * /super/clubs/{id}/instagram:
 *   get:
 *     summary: Obtener la configuración de Instagram de un club (sin el access token)
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Configuración (o null si no está configurado)
 *       404:
 *         description: Club no encontrado
 */
export const getClubInstagramConfigHandler = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id).lean();
    if (!club) return res.status(404).json({ message: 'Club no encontrado' });

    // El accessToken es write-only: nunca se devuelve en texto plano.
    const config = await InstagramConfig.findOne({ clubId: club.slug }, '-accessToken').lean();

    res.status(200).json(config ?? null);
  } catch (error) {
    console.error('Error obteniendo configuración de Instagram:', error);
    res.status(500).json({ message: 'Error al obtener configuración de Instagram' });
  }
};

