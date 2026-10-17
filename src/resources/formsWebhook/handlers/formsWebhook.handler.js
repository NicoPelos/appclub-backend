import { notifyRoles } from '../../../services/pushNotification.service.js';

const TIPO_LABELS = {
  socio: 'inscripción de socio',
  escuelita_ninos: 'inscripción a escuelita de niños/adolescentes',
  escuela_adultos: 'inscripción a escuela de adultos',
  viaje: 'inscripción a un viaje de trekking',
};

/**
 * @openapi
 * /api/forms-webhook:
 *   post:
 *     summary: Webhook público para respuestas de Google Forms (dispara notificación a autoridades/secretaría)
 *     tags: [FormsWebhook]
 *     parameters:
 *       - in: header
 *         name: x-webhook-secret
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [tipo, nombre]
 *             properties:
 *               tipo:
 *                 type: string
 *                 enum: [socio, escuelita_ninos, escuela_adultos, viaje]
 *               nombre:
 *                 type: string
 *     responses:
 *       200:
 *         description: Notificación enviada
 *       400:
 *         description: Datos inválidos
 *       401:
 *         description: Secreto de webhook inválido
 *       500:
 *         description: Error procesando el webhook
 */
export const formsWebhookHandler = async (req, res) => {
  try {
    const secret = req.headers['x-webhook-secret'];
    if (!secret || secret !== process.env.FORMS_WEBHOOK_SECRET) {
      return res.status(401).json({ message: 'No autorizado' });
    }

    const { tipo, nombre } = req.body || {};

    if (!tipo || !TIPO_LABELS[tipo]) {
      return res.status(400).json({ message: `tipo inválido. Válidos: ${Object.keys(TIPO_LABELS).join(', ')}` });
    }
    if (!nombre || typeof nombre !== 'string') {
      return res.status(400).json({ message: 'nombre es requerido' });
    }

    const clubId = process.env.DEFAULT_CLUB_ID;

    await notifyRoles(clubId, ['autoridad', 'secretaria'], {
      title: '📋 Nueva solicitud',
      body: `${nombre} completó el formulario de ${TIPO_LABELS[tipo]}`,
      data: { tipo: 'solicitud_form', formTipo: tipo },
    });

    res.status(200).json({ message: 'Notificación enviada' });
  } catch (error) {
    console.error('Error procesando webhook de formulario:', error);
    res.status(500).json({ message: 'Error al procesar el formulario' });
  }
};

export default formsWebhookHandler;
