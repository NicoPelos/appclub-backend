import { syncInstagramFeed } from '../services/syncInstagram.service.js';

/**
 * @openapi
 * /api/novedades/sync:
 *   post:
 *     summary: Forzar sincronización inmediata con Instagram (Graph API)
 *     tags: [Novedades]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Sincronización completada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 message: { type: string }
 *                 inserted: { type: integer }
 *                 skipped: { type: integer }
 *                 total: { type: integer }
 *       500:
 *         description: Error al sincronizar (ej. Instagram no configurado para este club)
 */
export const syncNovedadesHandler = async (req, res) => {
  try {
    const clubId = req.user?.clubId;

    const result = await syncInstagramFeed({ clubId });

    res.status(200).json({
      message: 'Sincronización completada',
      ...result,
    });
  } catch (error) {
    console.error('Error sincronizando Instagram:', error);
    res.status(500).json({ message: error.message || 'Error al sincronizar' });
  }
};
