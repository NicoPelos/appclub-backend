import PagoOnlineIntent from '../models/PagoOnlineIntent.js';
import { procesarPagoMercadoPago } from './procesarPagoMercadoPago.service.js';

const MP_API_BASE = 'https://api.mercadopago.com';

// Red de seguridad para cuando ni el Webhook ni el IPN de Mercado Pago
// llegan (ver saga de Hookdeck/502 intermitentes): un intent pendiente no
// tiene mpPaymentId propio, así que se busca por external_reference, que sí
// generamos nosotros al crear la preferencia.
const DIAS_MAXIMOS_A_REVISAR = 7;

const buscarPagoPorExternalReference = async ({ accessToken, externalReference }) => {
  const url = `${MP_API_BASE}/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) {
    // appcarc-backend#259: antes esto se tragaba el status sin dejar rastro —
    // si Mercado Pago empezaba a devolver 401/429/500 para TODAS las
    // búsquedas (token vencido, rate limit) no había ninguna señal en los
    // logs, solo "0 resueltos" silencioso.
    console.error(`Búsqueda de pago por external_reference ${externalReference} respondió ${response.status}`);
    return null;
  }
  const data = await response.json();
  const results = data?.results || [];
  if (!results.length) return null;
  return results.find((p) => p.status === 'approved') || results[0];
};

/**
 * Revisa los PagoOnlineIntent pendientes de un club contra la API de
 * búsqueda de pagos de Mercado Pago. Usado tanto por el cron cada 30 min
 * como por el botón manual de "revisar ahora" en la app.
 */
export const reconciliarPagosMercadoPagoClub = async ({ clubId, accessToken }) => {
  const desde = new Date(Date.now() - DIAS_MAXIMOS_A_REVISAR * 24 * 60 * 60 * 1000);
  const pendientes = await PagoOnlineIntent.find({
    clubId,
    estado: 'pendiente',
    createdAt: { $gte: desde },
  });

  let resueltos = 0;
  let errores = 0;
  for (const intent of pendientes) {
    // appcarc-backend#259: antes, si procesarPagoMercadoPago (o la búsqueda)
    // tiraba una excepción para UN intent, el for terminaba ahí y todos los
    // intents pendientes restantes del club quedaban sin revisar hasta la
    // próxima corrida del cron — un solo caso raro bloqueaba el resto del
    // lote. Ahora se aísla por intent y se sigue con los demás.
    try {
      const payment = await buscarPagoPorExternalReference({
        accessToken,
        externalReference: intent.externalReference,
      });
      if (!payment) continue;

      const { resultado } = await procesarPagoMercadoPago({ clubId, payment, accessToken });
      if (resultado === 'aprobado' || resultado === 'rechazado') resueltos++;
    } catch (err) {
      console.error(`Error reconciliando el intent ${intent._id} (club ${clubId}):`, err);
      errores++;
    }
  }

  // appcarc-backend#260: el estado 'expirado' del modelo nunca se asignaba —
  // un intent pendiente que quedaba fuera de la ventana de revisión (más de
  // DIAS_MAXIMOS_A_REVISAR días) no se tocaba más: ni se reconciliaba ni se
  // marcaba como cerrado, quedando 'pendiente' para siempre y contando como
  // deuda/link activo en la vista del socio aunque el checkout ya no sirva
  // (Checkout Pro expira sus preferencias mucho antes de los 7 días).
  const { modifiedCount: expirados } = await PagoOnlineIntent.updateMany(
    { clubId, estado: 'pendiente', createdAt: { $lt: desde } },
    { $set: { estado: 'expirado' } },
  );

  return { revisados: pendientes.length, resueltos, errores, expirados };
};
