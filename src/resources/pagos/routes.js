import express from 'express';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { crearPreferenciaCobroMercadoPagoHandler } from './handlers/crearPreferenciaCobroMercadoPago.handler.js';
import { crearPreferenciaCobroPropioMercadoPagoHandler } from './handlers/crearPreferenciaCobroPropioMercadoPago.handler.js';
import { reconciliarPagosMercadoPagoHandler } from './handlers/reconciliarPagosMercadoPago.handler.js';

const router = express.Router();

router.post('/mercadopago/preferencia-cobro', protect, authorize(PERMISOS.COBROS_WRITE), crearPreferenciaCobroMercadoPagoHandler);
router.post('/mercadopago/preferencia-propia', protect, crearPreferenciaCobroPropioMercadoPagoHandler);
router.post('/mercadopago/reconciliar', protect, authorize(PERMISOS.COBROS_WRITE), reconciliarPagosMercadoPagoHandler);

export default router;
