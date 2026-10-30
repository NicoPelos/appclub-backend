import Movimiento from '../models/Movimiento.js';
import MercadoPagoConfig from '../../pagos/models/MercadoPagoConfig.js';
import { obtenerPagoMercadoPago } from '../../pagos/services/procesarPagoMercadoPago.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/movimientos/{id}/mercadopago-vinculo:
 *   post:
 *     summary: Vincular manualmente un Movimiento (Ingreso o Egreso) con un pago real de Mercado Pago — admite más de uno por movimiento
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentId]
 *             properties:
 *               paymentId: { type: string }
 *               payerName: { type: string, description: "Nombre del pagador leído a mano (captura o reporte 'Estado de cuenta') cuando la API de pagos no lo trae — appcarc-backend#274. Alimenta el aprendizaje histórico por pagador." }
 *     responses:
 *       200:
 *         description: Vínculo guardado
 *       400:
 *         description: El movimiento es Efectivo, o el pago no existe/no está aprobado
 *       404:
 *         description: Movimiento no encontrado
 *       409:
 *         description: Ese pago ya está vinculado a este movimiento
 */
export const vincularMercadopagoHandler = async (req, res) => {
  try {
    const { id } = req.params;
    const { paymentId, payerName = '' } = req.body;
    if (!paymentId) return res.status(400).json({ message: 'Falta paymentId' });

    const movimiento = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!movimiento) return res.status(404).json({ message: 'Movimiento no encontrado' });
    if (movimiento.paymentMethod === 'Efectivo') {
      return res.status(400).json({ message: 'Solo se puede vincular un movimiento por Transferencia o Mercado Pago' });
    }

    const config = await MercadoPagoConfig.findOne({ clubId: req.user?.clubId, active: true });
    if (!config) return res.status(400).json({ message: 'El club no tiene Mercado Pago configurado' });

    const { ok, payment } = await obtenerPagoMercadoPago({ accessToken: config.accessToken, dataId: paymentId });
    if (!ok || payment.status !== 'approved') {
      return res.status(400).json({ message: 'Ese pago no existe o no está aprobado en Mercado Pago' });
    }

    // Un mismo pago SÍ puede corresponder a más de un movimiento (ver
    // mercadopagoCandidatos.handler.js) — solo se evita vincularlo dos
    // veces al mismo movimiento.
    if (movimiento.mercadopagoVinculos.some((v) => v.paymentId === String(payment.id))) {
      return res.status(409).json({ message: 'Ese pago ya está vinculado a este movimiento' });
    }

    const actor = getActor(req);
    const before = movimiento.mercadopagoVinculos;
    // Para un Egreso, el club es el payer del pago de MP — la contraparte
    // (a quién se le pagó) es el collector, no el payer.
    const contraparteEmail = movimiento.type === 'Egreso' ? payment.collector?.email : payment.payer?.email;
    movimiento.mercadopagoVinculos.push({
      paymentId: String(payment.id),
      payerEmail: contraparteEmail ?? '',
      payerName: payerName.trim(),
      monto: payment.transaction_amount,
      fecha: payment.date_approved,
      vinculadoPor: actor,
    });
    // El medio de pago pasa a reflejar la realidad — llegó por Mercado Pago,
    // no una transferencia bancaria genérica. Se revierte cuando se quita
    // el último vínculo (ver desvincularMercadopagoHandler).
    movimiento.paymentMethod = 'MercadoPago';
    movimiento.updatedBy = actor;
    await movimiento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before, after: movimiento.mercadopagoVinculos });
    res.json(movimiento);
  } catch (error) {
    console.error('Error vinculando pago de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al vincular el pago' });
  }
};

/**
 * @openapi
 * /api/movimientos/{id}/mercadopago-vinculo/{paymentId}:
 *   delete:
 *     summary: Quitar uno de los vínculos con Mercado Pago de un movimiento
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Vínculo quitado
 *       404:
 *         description: Movimiento no encontrado, o no tenía ese vínculo
 */
export const desvincularMercadopagoHandler = async (req, res) => {
  try {
    const { id, paymentId } = req.params;
    const movimiento = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!movimiento) return res.status(404).json({ message: 'Movimiento no encontrado' });

    const antes = movimiento.mercadopagoVinculos.length;
    const before = movimiento.mercadopagoVinculos;
    movimiento.mercadopagoVinculos = movimiento.mercadopagoVinculos.filter((v) => v.paymentId !== paymentId);
    if (movimiento.mercadopagoVinculos.length === antes) {
      return res.status(404).json({ message: 'Ese movimiento no tiene ese vínculo' });
    }

    const actor = getActor(req);
    if (movimiento.mercadopagoVinculos.length === 0 && movimiento.paymentMethod === 'MercadoPago') {
      movimiento.paymentMethod = 'Transferencia';
    }
    movimiento.updatedBy = actor;
    await movimiento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before, after: movimiento.mercadopagoVinculos });
    res.json(movimiento);
  } catch (error) {
    console.error('Error quitando vínculo de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al quitar el vínculo' });
  }
};

// Largo máximo razonable para un nombre leído de una captura o del
// "Estado de cuenta" de MP (los nombres más largos vistos rondan los 50).
const PAYER_NAME_MAX = 120;

/**
 * @openapi
 * /api/movimientos/{id}/mercadopago-vinculo/{paymentId}:
 *   patch:
 *     summary: Completar o corregir el nombre del pagador de un vínculo con Mercado Pago ya existente
 *     description: >
 *       Solo actualiza `payerName` del vínculo — no toca monto, fecha, forma de
 *       pago ni el resto del movimiento. Sirve para completar a posteriori el
 *       nombre leído del reporte "Estado de cuenta" de MP (cuyo REFERENCE_ID es
 *       el paymentId) en vínculos creados sin nombre, y así alimentar el
 *       aprendizaje histórico por pagador (appcarc-backend#274).
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [payerName]
 *             properties:
 *               payerName: { type: string, maxLength: 120 }
 *     responses:
 *       200:
 *         description: Nombre actualizado (o ya era ese)
 *       400:
 *         description: payerName vacío, no es texto o es demasiado largo
 *       404:
 *         description: Movimiento no encontrado, o no tiene ese vínculo
 */
export const actualizarPayerMercadopagoHandler = async (req, res) => {
  try {
    const { id, paymentId } = req.params;
    const { payerName } = req.body ?? {};
    if (typeof payerName !== 'string' || !payerName.trim()) {
      return res.status(400).json({ message: 'Falta payerName' });
    }
    const nombre = payerName.trim();
    if (nombre.length > PAYER_NAME_MAX) {
      return res.status(400).json({ message: `payerName no puede superar ${PAYER_NAME_MAX} caracteres` });
    }

    const movimiento = await Movimiento.findOne({ _id: id, clubId: req.user?.clubId, active: true });
    if (!movimiento) return res.status(404).json({ message: 'Movimiento no encontrado' });

    const vinculo = movimiento.mercadopagoVinculos.find((v) => v.paymentId === String(paymentId));
    if (!vinculo) return res.status(404).json({ message: 'Ese movimiento no tiene ese vínculo' });

    // Idempotente: si ya tenía ese nombre no se guarda ni se audita nada.
    if (vinculo.payerName === nombre) return res.json(movimiento);

    const before = { paymentId: vinculo.paymentId, payerName: vinculo.payerName };
    vinculo.payerName = nombre;
    movimiento.updatedBy = getActor(req);
    await movimiento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Movimiento', resourceId: movimiento._id, before, after: { paymentId: vinculo.paymentId, payerName: nombre } });
    res.json(movimiento);
  } catch (error) {
    console.error('Error actualizando el pagador del vínculo de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al actualizar el pagador' });
  }
};
