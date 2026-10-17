import Movimiento, { CATEGORIAS_MOVIMIENTO } from '../models/Movimiento.js';
import MercadoPagoConfig from '../../pagos/models/MercadoPagoConfig.js';
import MercadopagoDescartado from '../../pagos/models/MercadopagoDescartado.js';
import { buscarPagosMercadoPago } from '../../pagos/services/buscarPagosMercadoPago.service.js';
import { obtenerPagoMercadoPago } from '../../pagos/services/procesarPagoMercadoPago.service.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

const DIAS_DEFAULT = 30;

/**
 * @openapi
 * /api/movimientos/mercadopago-sin-vincular:
 *   get:
 *     summary: Pagos de Mercado Pago en un rango de fechas que no están vinculados a ningún movimiento ni descartados
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: desde
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: hasta
 *         schema: { type: string, format: date }
 *       - in: query
 *         name: direccion
 *         schema: { type: string, enum: [ingreso, egreso], default: ingreso }
 *     responses:
 *       200:
 *         description: Lista de pagos sin vincular, ordenados por fecha descendente
 *       400:
 *         description: El club no tiene Mercado Pago configurado
 */
export const mercadopagoSinVincularHandler = async (req, res) => {
  try {
    const config = await MercadoPagoConfig.findOne({ clubId: req.user?.clubId, active: true });
    if (!config) return res.status(400).json({ message: 'El club no tiene Mercado Pago configurado' });

    const hasta = req.query.hasta ? new Date(`${req.query.hasta}T23:59:59.999Z`) : new Date();
    const desde = req.query.desde
      ? new Date(`${req.query.desde}T00:00:00.000Z`)
      : new Date(hasta.getTime() - DIAS_DEFAULT * 24 * 60 * 60 * 1000);
    const direccion = req.query.direccion === 'egreso' ? 'egreso' : 'ingreso';

    const pagos = await buscarPagosMercadoPago({ accessToken: config.accessToken, desde, hasta, direccion });
    const paymentIds = pagos.map((p) => p.paymentId);

    const [vinculados, descartados] = await Promise.all([
      Movimiento.distinct('mercadopagoVinculos.paymentId', {
        clubId: req.user?.clubId,
        active: true,
        'mercadopagoVinculos.paymentId': { $in: paymentIds },
      }),
      MercadopagoDescartado.find({ clubId: req.user?.clubId, paymentId: { $in: paymentIds } }).lean(),
    ]);
    const vinculadosSet = new Set(vinculados);
    const descartadosSet = new Set(descartados.map((d) => d.paymentId));

    const sinVincular = pagos
      .filter((p) => !vinculadosSet.has(p.paymentId) && !descartadosSet.has(p.paymentId))
      .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    res.json(sinVincular);
  } catch (error) {
    console.error('Error buscando pagos de Mercado Pago sin vincular:', error);
    res.status(500).json({ message: 'Error al buscar pagos sin vincular' });
  }
};

/**
 * @openapi
 * /api/movimientos/mercadopago-sin-vincular/{paymentId}/descartar:
 *   post:
 *     summary: Marcar un pago de Mercado Pago como revisado (no corresponde vincularlo a ningún movimiento)
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               motivo: { type: string }
 *     responses:
 *       200:
 *         description: Marcado como descartado
 */
export const descartarMercadopagoHandler = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { motivo = '' } = req.body ?? {};
    const actor = getActor(req);

    const descartado = await MercadopagoDescartado.findOneAndUpdate(
      { clubId: req.user?.clubId, paymentId },
      { motivo: motivo.trim(), descartadoPor: actor },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    res.json(descartado);
  } catch (error) {
    console.error('Error descartando pago de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al descartar el pago' });
  }
};

/**
 * @openapi
 * /api/movimientos/mercadopago-sin-vincular/descartar-bulk:
 *   post:
 *     summary: Marcar varios pagos de Mercado Pago como revisados de una vez
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentIds]
 *             properties:
 *               paymentIds: { type: array, items: { type: string } }
 *               motivo: { type: string }
 *     responses:
 *       200:
 *         description: Cantidad de pagos descartados
 *       400:
 *         description: Falta paymentIds
 */
export const descartarMercadopagoBulkHandler = async (req, res) => {
  try {
    const { paymentIds, motivo = '' } = req.body ?? {};
    if (!Array.isArray(paymentIds) || paymentIds.length === 0) {
      return res.status(400).json({ message: 'Falta paymentIds' });
    }
    const actor = getActor(req);

    const result = await MercadopagoDescartado.bulkWrite(
      paymentIds.map((paymentId) => ({
        updateOne: {
          filter: { clubId: req.user?.clubId, paymentId },
          update: { $set: { motivo: motivo.trim(), descartadoPor: actor } },
          upsert: true,
        },
      })),
    );
    res.json({ descartados: paymentIds.length, ...result });
  } catch (error) {
    console.error('Error descartando pagos de Mercado Pago en lote:', error);
    res.status(500).json({ message: 'Error al descartar los pagos' });
  }
};

/**
 * @openapi
 * /api/movimientos/mercadopago-descartados:
 *   get:
 *     summary: Listar los pagos de Mercado Pago marcados como descartados
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Lista de descartados, más reciente primero
 */
export const getMercadopagoDescartadosHandler = async (req, res) => {
  try {
    const descartados = await MercadopagoDescartado
      .find({ clubId: req.user?.clubId })
      .sort({ createdAt: -1 })
      .lean();
    res.json(descartados);
  } catch (error) {
    console.error('Error listando pagos descartados de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al listar los descartados' });
  }
};

/**
 * @openapi
 * /api/movimientos/mercadopago-descartados/{paymentId}:
 *   delete:
 *     summary: Deshacer el descarte de un pago (vuelve a aparecer en "sin vincular")
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Descarte deshecho
 *       404:
 *         description: No estaba descartado
 */
export const restaurarMercadopagoDescartadoHandler = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const eliminado = await MercadopagoDescartado.findOneAndDelete({ clubId: req.user?.clubId, paymentId });
    if (!eliminado) return res.status(404).json({ message: 'Ese pago no estaba descartado' });
    res.json({ message: 'Descarte deshecho' });
  } catch (error) {
    console.error('Error restaurando pago descartado de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al restaurar el descarte' });
  }
};

/**
 * @openapi
 * /api/movimientos/mercadopago-sin-vincular/{paymentId}/crear-egreso:
 *   post:
 *     summary: Crear un Movimiento Egreso a partir de un pago saliente de Mercado Pago sin vincular, ya vinculado en el mismo paso
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [concept, categoria, responsable]
 *             properties:
 *               concept: { type: string }
 *               categoria: { type: string }
 *               responsable: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Movimiento creado y vinculado
 *       400:
 *         description: Datos inválidos, el club no tiene Mercado Pago configurado, o el pago no existe/no está aprobado
 *       409:
 *         description: Ese pago ya está vinculado a otro movimiento
 */
export const crearEgresoDesdeMercadopagoHandler = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { concept, categoria, responsable, description = '' } = req.body ?? {};

    if (!concept?.trim()) return res.status(400).json({ message: 'El concepto es obligatorio' });
    if (!categoria || !CATEGORIAS_MOVIMIENTO.Egreso.includes(categoria)) {
      return res.status(400).json({ message: `La categoría debe ser una de: ${CATEGORIAS_MOVIMIENTO.Egreso.join(', ')}` });
    }
    if (!responsable?.trim()) return res.status(400).json({ message: 'El responsable es obligatorio' });

    const config = await MercadoPagoConfig.findOne({ clubId: req.user?.clubId, active: true });
    if (!config) return res.status(400).json({ message: 'El club no tiene Mercado Pago configurado' });

    const { ok, payment } = await obtenerPagoMercadoPago({ accessToken: config.accessToken, dataId: paymentId });
    if (!ok || payment.status !== 'approved') {
      return res.status(400).json({ message: 'Ese pago no existe o no está aprobado en Mercado Pago' });
    }

    const yaVinculado = await Movimiento.findOne({
      clubId: req.user?.clubId,
      active: true,
      'mercadopagoVinculos.paymentId': String(payment.id),
    }).select('_id').lean();
    if (yaVinculado) return res.status(409).json({ message: 'Ese pago ya está vinculado a otro movimiento' });

    const actor = getActor(req);
    // El Movimiento refleja lo que recibió la contraparte (transaction_amount),
    // no el total con el cargo de MP (0,6% o intereses de cuotas): así un
    // honorario o una factura figuran por su valor real. La comisión se
    // registra aparte como "Comisiones Mercado Pago" y se avisa en la descripción.
    const monto = payment.transaction_amount;
    const totalPagado = payment.transaction_details?.total_paid_amount ?? monto;
    const comision = Math.round((totalPagado - monto) * 100) / 100;
    const descripcion = comision > 0.005
      ? `${description.trim()}${description.trim() ? ' — ' : ''}Comisión de Mercado Pago: $${comision.toFixed(2)} (registrar aparte)`
      : description.trim();

    const movimiento = new Movimiento({
      clubId: req.user.clubId,
      userId: req.user.id,
      responsable: responsable.trim(),
      type: 'Egreso',
      amount: monto,
      concept: concept.trim(),
      categoria,
      paymentMethod: 'MercadoPago',
      description: descripcion,
      date: payment.date_approved ? new Date(payment.date_approved) : new Date(),
      createdBy: actor,
      updatedBy: actor,
      mercadopagoVinculos: [{
        paymentId: String(payment.id),
        payerEmail: payment.collector?.email ?? '',
        monto,
        fecha: payment.date_approved,
        vinculadoPor: actor,
      }],
    });
    await movimiento.save();

    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Movimiento', resourceId: movimiento._id, before: null, after: movimiento.toObject() });
    res.status(201).json(movimiento);
  } catch (error) {
    console.error('Error creando egreso desde pago de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al crear el egreso' });
  }
};
