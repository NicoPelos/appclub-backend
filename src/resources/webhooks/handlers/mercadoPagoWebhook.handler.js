import MercadoPagoConfig from '../../pagos/models/MercadoPagoConfig.js';
import { verifyMercadoPagoSignature } from '../services/verifyMercadoPagoSignature.service.js';
import { obtenerPagoMercadoPago, procesarPagoMercadoPago } from '../../pagos/services/procesarPagoMercadoPago.service.js';

/**
 * @openapi
 * /api/webhooks/mercadopago/{clubId}:
 *   post:
 *     summary: Notificación de Mercado Pago para un club (pública, verificada por firma HMAC propia del club)
 *     description: >
 *       La URL incluye el clubId porque cada club usa su propia cuenta de Mercado Pago
 *       (sin OAuth Connect) — así se sabe de entrada qué credenciales/secreto usar
 *       para verificar, sin depender de datos no verificados del body.
 *     tags: [Webhooks]
 *     parameters:
 *       - in: path
 *         name: clubId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Procesado (o ignorado si no aplica)
 *       401:
 *         description: Firma inválida o club sin Mercado Pago configurado
 */
export const mercadoPagoWebhookHandler = async (req, res) => {
  try {
    const { clubId } = req.params;

    // IPN (el mecanismo viejo, en paralelo a Webhooks) manda topic/id como
    // query params y nunca firma con x-signature — se detecta por la
    // ausencia de ese header, no por una ruta/formato distinto.
    const isIpn = !req.headers['x-signature'];

    const type = req.body?.type || req.query?.type || req.query?.topic;
    if (type && type !== 'payment') {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const dataId = req.body?.data?.id || req.query['data.id'] || req.query?.id;
    // dataId termina interpolado sin sanitizar en la URL del request
    // autenticado a la API de Mercado Pago (procesarPagoMercadoPago.service.js)
    // — sin validar el formato, un valor como "1/../../v1/account/settings"
    // deja mandar ahí un GET arbitrario con el accessToken real del club
    // (appcarc-backend#214). Los IDs de pago de MP son siempre numéricos.
    if (!dataId || !/^\d+$/.test(String(dataId))) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const config = await MercadoPagoConfig.findOne({ clubId, active: true });
    if (!config?.webhookSecret || !config?.accessToken) {
      console.error(`Webhook de Mercado Pago recibido para club ${clubId} sin configuración completa`);
      return res.status(401).json({ message: 'No verificado' });
    }

    // IPN no manda firma — la autenticidad se apoya en el paso siguiente
    // (volver a pedir el pago a la API de Mercado Pago con nuestro propio
    // accessToken): un tercero que mande un topic/id inventado nunca hace
    // avanzar el flujo, porque el pago real resultante no va a matchear
    // ningún PagoOnlineIntent pendiente. Para Webhooks (si manda firma) se
    // sigue exigiendo que verifique, igual que antes.
    if (!isIpn) {
      const signatureOk = verifyMercadoPagoSignature({
        xSignature: req.headers['x-signature'],
        xRequestId: req.headers['x-request-id'],
        dataId,
        webhookSecret: config.webhookSecret,
      });

      if (!signatureOk) {
        console.error(`Firma inválida en webhook de Mercado Pago para club ${clubId}`);
        return res.status(401).json({ message: 'Firma inválida' });
      }
    }

    // A partir de acá (firma validada, o notificación IPN sin firma posible)
    // se confía en cualquier dato recién después de volver a pedirlo a la
    // API de Mercado Pago con nuestras propias credenciales.
    const { ok, status, payment } = await obtenerPagoMercadoPago({ accessToken: config.accessToken, dataId });

    if (!ok) {
      console.error(`No se pudo obtener el pago ${dataId} de Mercado Pago (club ${clubId}):`, status);
      // MP decide si reintenta según el código HTTP, no según el body — un
      // 200 acá da la notificación por entregada y el pago no se acredita.
      return res.status(502).json({ ok: false, retry: true });
    }

    const { resultado } = await procesarPagoMercadoPago({ clubId, payment, accessToken: config.accessToken });

    if (resultado === 'duplicado') return res.status(200).json({ ok: true, duplicate: true });

    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Error procesando webhook de Mercado Pago:', error);
    // Igual que arriba: un 200 acá da la notificación por entregada y MP
    // nunca reintenta, aunque el error haya sido transitorio (ej. Mongo).
    return res.status(500).json({ ok: false });
  }
};

export default mercadoPagoWebhookHandler;
