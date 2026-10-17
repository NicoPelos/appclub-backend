import { BusinessError, registrarPagoEventoParticipante } from '../services/registrarPagoEventoParticipante.service.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/eventos/{eventoId}/participantes/{participanteId}/pagos:
 *   post:
 *     summary: Registrar el pago de un participante (total o a cuenta/seña)
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventoId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: participanteId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monto, paymentMethod]
 *             properties:
 *               monto: { type: number }
 *               paymentMethod: { type: string, enum: [Efectivo, Transferencia] }
 *               esPagoParcial:
 *                 type: boolean
 *                 description: Si es true y el monto no cubre lo esperado, el participante queda "parcial" con el resto como saldo pendiente. Nunca se infiere del monto.
 *               date: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Pago registrado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Evento o participante no encontrado
 *       409:
 *         description: El evento está cerrado, o el participante ya está pagado/anulado
 *       500:
 *         description: Error al registrar el pago
 */
export const registrarPagoEventoParticipanteHandler = async (req, res) => {
  try {
    const { eventoId, participanteId } = req.params;
    const { monto, paymentMethod, esPagoParcial, date } = req.body;

    const result = await registrarPagoEventoParticipante({
      clubId: req.user?.clubId,
      user: req.user,
      eventoId,
      participanteId,
      monto,
      paymentMethod,
      esPagoParcial,
      date,
    });

    logAudit({
      clubId: req.user?.clubId, req, action: 'CREATE', resource: 'EventoParticipantePago',
      resourceId: result.movimiento._id, before: null, after: result.participante.toObject(),
    });
    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof BusinessError) return res.status(error.status).json({ message: error.message });
    console.error('Error registrando el pago del participante:', error);
    return res.status(500).json({ message: 'Error al registrar el pago' });
  }
};

export default registrarPagoEventoParticipanteHandler;
