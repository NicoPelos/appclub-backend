import crypto from 'node:crypto';

// Verifica la firma que Mercado Pago manda en el header x-signature de cada
// notificación de webhook, según su algoritmo documentado:
// https://www.mercadopago.com.ar/developers/es/docs/checkout-api/additional-content/your-integrations/notifications/webhooks#editor_5
//
// x-signature tiene la forma "ts=<timestamp>,v1=<hmac-hex>".
// El manifest a firmar es: `id:<dataId>;request-id:<xRequestId>;ts:<ts>;`
// (con los ";" al final de cada campo). Se compara con HMAC-SHA256 usando el
// webhookSecret propio de cada club, en tiempo constante.
export const verifyMercadoPagoSignature = ({ xSignature, xRequestId, dataId, webhookSecret }) => {
  if (!xSignature || !xRequestId || !dataId || !webhookSecret) return false;

  const parts = Object.fromEntries(
    xSignature.split(',').map((p) => {
      const [key, value] = p.split('=');
      return [key?.trim(), value?.trim()];
    }),
  );

  const { ts, v1 } = parts;
  if (!ts || !v1) return false;

  const normalizedDataId = String(dataId).toLowerCase();
  const manifest = `id:${normalizedDataId};request-id:${xRequestId};ts:${ts};`;

  const expected = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');

  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(v1, 'hex');
  if (expectedBuf.length !== receivedBuf.length) return false;

  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
};

export default verifyMercadoPagoSignature;
