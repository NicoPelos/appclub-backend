import Movimiento from '../models/Movimiento.js';
import MercadoPagoConfig from '../../pagos/models/MercadoPagoConfig.js';
import { buscarPagosMercadoPago } from '../../pagos/services/buscarPagosMercadoPago.service.js';

const DIAS_DEFAULT = 30;

/**
 * @openapi
 * /api/movimientos/conciliacion-mercadopago:
 *   get:
 *     summary: Totales de Mercado Pago vs Movimientos en un rango, y descuadres de sumas cuando un pago cubre varios movimientos o un movimiento junta varios pagos
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
 *     responses:
 *       200:
 *         description: Totales y descuadres
 *       400:
 *         description: El club no tiene Mercado Pago configurado
 */
export const conciliacionMercadopagoHandler = async (req, res) => {
  try {
    const clubId = req.user?.clubId;
    const config = await MercadoPagoConfig.findOne({ clubId, active: true });
    if (!config) return res.status(400).json({ message: 'El club no tiene Mercado Pago configurado' });

    const hasta = req.query.hasta ? new Date(`${req.query.hasta}T23:59:59.999Z`) : new Date();
    const desde = req.query.desde
      ? new Date(`${req.query.desde}T00:00:00.000Z`)
      : new Date(hasta.getTime() - DIAS_DEFAULT * 24 * 60 * 60 * 1000);

    // Los pagos "reales" de MP para el total del período — a diferencia de
    // "sin vincular" (que busca en un rango centrado en cada movimiento),
    // acá se trae TODO el historial de pagos de la cuenta en el rango
    // elegido, estén vinculados o no, para poder comparar el total real
    // contra lo que quedó registrado en Movimientos.
    const [pagosIngreso, pagosEgreso] = await Promise.all([
      buscarPagosMercadoPago({ accessToken: config.accessToken, desde, hasta, direccion: 'ingreso' }),
      buscarPagosMercadoPago({ accessToken: config.accessToken, desde, hasta, direccion: 'egreso' }),
    ]);
    const totalIngresoMp = pagosIngreso.reduce((s, p) => s + p.monto, 0);
    const totalEgresoMp = pagosEgreso.reduce((s, p) => s + p.monto, 0);

    const movimientos = await Movimiento.find({
      clubId, active: true, date: { $gte: desde, $lte: hasta }, paymentMethod: 'MercadoPago',
    }).select('type amount concept date mercadopagoVinculos').lean();

    const totalIngresoMovimientos = movimientos
      .filter((m) => m.type === 'Ingreso')
      .reduce((s, m) => s + m.amount, 0);
    const totalEgresoMovimientos = movimientos
      .filter((m) => m.type === 'Egreso')
      .reduce((s, m) => s + m.amount, 0);

    // Caso "1 pago = varios movimientos": el mismo paymentId aparece en el
    // vínculo de más de un Movimiento (alguien que transfirió junto la cuota
    // de 2 personas, registrado como 2 cobros separados) — la suma de esos
    // Movimientos tiene que dar el monto real del pago.
    const movimientosPorPaymentId = new Map();
    for (const m of movimientos) {
      for (const v of m.mercadopagoVinculos ?? []) {
        if (!movimientosPorPaymentId.has(v.paymentId)) movimientosPorPaymentId.set(v.paymentId, []);
        movimientosPorPaymentId.get(v.paymentId).push({
          movimientoId: m._id, concept: m.concept, amount: m.amount, vinculoMonto: v.monto,
        });
      }
    }
    const descuadresPago = [];
    for (const [paymentId, movs] of movimientosPorPaymentId) {
      if (movs.length < 2) continue;
      const montoReal = movs[0].vinculoMonto;
      const sumaMovimientos = movs.reduce((s, m) => s + m.amount, 0);
      if (sumaMovimientos !== montoReal) {
        descuadresPago.push({
          paymentId,
          montoReal,
          sumaMovimientos,
          diferencia: sumaMovimientos - montoReal,
          movimientos: movs.map((m) => ({ movimientoId: m.movimientoId, concept: m.concept, amount: m.amount })),
        });
      }
    }

    // Caso "1 movimiento = varios pagos": un mismo Movimiento tiene más de un
    // vínculo (alguien que transfirió en 2 partes, registrado como un solo
    // cobro) — la suma de esos vínculos tiene que dar el monto del Movimiento.
    const descuadresMovimiento = [];
    for (const m of movimientos) {
      const vinculos = m.mercadopagoVinculos ?? [];
      if (vinculos.length < 2) continue;
      const sumaVinculos = vinculos.reduce((s, v) => s + v.monto, 0);
      if (sumaVinculos !== m.amount) {
        descuadresMovimiento.push({
          movimientoId: m._id,
          concept: m.concept,
          amount: m.amount,
          sumaVinculos,
          diferencia: sumaVinculos - m.amount,
          paymentIds: vinculos.map((v) => v.paymentId),
        });
      }
    }

    res.json({
      desde,
      hasta,
      totales: {
        ingresoMp: totalIngresoMp,
        ingresoMovimientos: totalIngresoMovimientos,
        egresoMp: totalEgresoMp,
        egresoMovimientos: totalEgresoMovimientos,
      },
      descuadresPago,
      descuadresMovimiento,
    });
  } catch (error) {
    console.error('Error calculando conciliación de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al calcular la conciliación' });
  }
};

export default conciliacionMercadopagoHandler;
