import Notification from '../models/Notification.js';

/**
 * @openapi
 * /api/notificaciones/me:
 *   get:
 *     summary: Obtener el historial de notificaciones del usuario actual
 *     tags: [Notificaciones]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de notificaciones (más recientes primero)
 *       500:
 *         description: Error al obtener notificaciones
 */
export const getMisNotificacionesHandler = async (req, res) => {
  try {
    // Se filtra por el perfil activo (socioId de la sesión) más las
    // generales del club (socioId null) — así, si estás actuando "como" un
    // hijo vinculado, no ves mezcladas las notificaciones de otro perfil de
    // la misma cuenta.
    const filter = { userId: req.user.id, clubId: req.user.clubId };
    if (req.user.socioId) {
      filter.$or = [{ socioId: req.user.socioId }, { socioId: null }];
    }

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ notifications });
  } catch (error) {
    console.error('Error obteniendo notificaciones:', error);
    res.status(500).json({ message: 'Error al obtener notificaciones' });
  }
};

export default getMisNotificacionesHandler;
