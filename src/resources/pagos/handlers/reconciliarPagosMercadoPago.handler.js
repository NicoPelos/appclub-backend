import MercadoPagoConfig from '../models/MercadoPagoConfig.js';
import { reconciliarPagosMercadoPagoClub } from '../services/reconciliarPagosMercadoPago.service.js';

/**
 * @openapi
 * /api/pagos/mercadopago/reconciliar:
 *   post:
 *     summary: Revisa ahora los pagos pendientes de Mercado Pago del club (admin o secretaria)
 *     description: >
 *       Dispara manualmente la misma revisión que corre sola cada 30 minutos: busca en la
 *       API de Mercado Pago si alguno de los pagos pendientes ya se acreditó o rechazó,
 *       para los casos en que el Webhook/IPN no haya llegado.
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Revisión completada
 *       400:
 *         description: El club no tiene Mercado Pago configurado
 */
export const reconciliarPagosMercadoPagoHandler = async (req, res) => {
  try {
    const clubId = req.user?.clubId;
    const config = await MercadoPagoConfig.findOne({ clubId, active: true });
    if (!config) {
      return res.status(400).json({ message: 'Este club todavía no configuró Mercado Pago' });
    }

    const { revisados, resueltos, errores, expirados } = await reconciliarPagosMercadoPagoClub({ clubId, accessToken: config.accessToken });
    res.status(200).json({ revisados, resueltos, errores, expirados });
  } catch (error) {
    console.error('Error revisando pagos pendientes de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al revisar pagos pendientes' });
  }
};

