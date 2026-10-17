import express from 'express';
import { formsWebhookHandler } from './handlers/formsWebhook.handler.js';

const router = express.Router();

// Público (sin `protect`): lo llama Google Apps Script, no un usuario logueado.
// Se protege con un secreto compartido (header x-webhook-secret).
router.post('/', formsWebhookHandler);

export default router;
