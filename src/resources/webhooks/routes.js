import express from 'express';
import { mercadoPagoWebhookHandler } from './handlers/mercadoPagoWebhook.handler.js';

const router = express.Router();

// Público (sin `protect`): lo llama Mercado Pago, no un usuario logueado.
// Se verifica con la firma HMAC propia de cada club (ver verifyMercadoPagoSignature).
router.post('/mercadopago/:clubId', mercadoPagoWebhookHandler);

export default router;
