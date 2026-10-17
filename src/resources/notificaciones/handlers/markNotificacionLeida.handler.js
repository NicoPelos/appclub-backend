import Notification from '../models/Notification.js';

/**
 * @openapi
 * /api/notificaciones/{id}/leida:
 *   put:
 *     summary: Marcar una notificación como leída
 *     tags: [Notificaciones]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Notificación marcada como leída
 *       404:
 *         description: Notificación no encontrada
 *       500:
 *         description: Error al marcar como leída
 */
export const markNotificacionLeidaHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId: req.user.id, clubId: req.user.clubId },
      { read: true },
      { new: true },
    );

    if (!notification) return res.status(404).json({ message: 'Notificación no encontrada' });

    res.status(200).json({ notification });
  } catch (error) {
    console.error('Error marcando notificación como leída:', error);
    res.status(500).json({ message: 'Error al marcar como leída' });
  }
};

export default markNotificacionLeidaHandler;
