import Notification from '../models/Notification.js';

/**
 * @openapi
 * /api/notificaciones/leidas:
 *   delete:
 *     summary: Eliminar las notificaciones ya leídas del usuario actual
 *     tags: [Notificaciones]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Notificaciones leídas eliminadas
 *       500:
 *         description: Error al eliminar notificaciones
 */
export const deleteNotificacionesLeidasHandler = async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user.id, clubId: req.user.clubId, read: true });
    res.status(200).json({ message: 'Notificaciones leídas eliminadas' });
  } catch (error) {
    console.error('Error eliminando notificaciones leídas:', error);
    res.status(500).json({ message: 'Error al eliminar notificaciones' });
  }
};

export default deleteNotificacionesLeidasHandler;
