import express from 'express';
import { createMovimientoHandler } from './handlers/createMovimiento.handler.js';
import { deleteMovimientoHandler } from './handlers/deleteMovimiento.handler.js';
import { getMovimientosHandler, getMovimientoByIdHandler } from './handlers/getMovimientos.handler.js';
import { updateMovimientoHandler } from './handlers/updateMovimiento.handler.js';
import { updateFechaBulkHandler } from './handlers/updateFechaBulk.handler.js';
import { upload, handleUploadError, uploadComprobanteHandler } from './handlers/uploadComprobante.handler.js';
import { deleteComprobanteHandler } from './handlers/deleteComprobante.handler.js';
import { mercadopagoCandidatosHandler } from './handlers/mercadopagoCandidatos.handler.js';
import { sugerirMercadopagoHandler } from './handlers/sugerirMercadopago.handler.js';
import { conciliacionMercadopagoHandler } from './handlers/conciliacionMercadopago.handler.js';
import { resumenPorCategoriaHandler, resumenPorCategoriaMensualHandler, resumenPorCategoriaDetalleHandler } from './handlers/resumenPorCategoria.handler.js';
import { vincularMercadopagoHandler, desvincularMercadopagoHandler } from './handlers/mercadopagoVinculo.handler.js';
import {
  mercadopagoSinVincularHandler, descartarMercadopagoHandler, descartarMercadopagoBulkHandler,
  getMercadopagoDescartadosHandler, restaurarMercadopagoDescartadoHandler, crearEgresoDesdeMercadopagoHandler,
} from './handlers/mercadopagoSinVincular.handler.js';
import { protect, authorize } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';

const router = express.Router();

router.get('/', protect, authorize(PERMISOS.MOVIMIENTOS_READ), getMovimientosHandler);
router.post('/', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), createMovimientoHandler);
router.post('/fecha-bulk', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), updateFechaBulkHandler);
router.put('/:id', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), updateMovimientoHandler);
router.delete('/:id', protect, authorize(PERMISOS.MOVIMIENTOS_DELETE), deleteMovimientoHandler);
router.post('/:id/comprobantes', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), upload.single('foto'), handleUploadError, uploadComprobanteHandler);
router.delete('/:id/comprobantes/:comprobanteId', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), deleteComprobanteHandler);
router.get('/:id/mercadopago-candidatos', protect, authorize(PERMISOS.MOVIMIENTOS_READ), mercadopagoCandidatosHandler);
router.post('/:id/mercadopago-vinculo', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), vincularMercadopagoHandler);
router.delete('/:id/mercadopago-vinculo/:paymentId', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), desvincularMercadopagoHandler);
router.get('/mercadopago-sin-vincular', protect, authorize(PERMISOS.MOVIMIENTOS_READ), mercadopagoSinVincularHandler);
router.post('/mercadopago-sin-vincular/descartar-bulk', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), descartarMercadopagoBulkHandler);
router.post('/mercadopago-sin-vincular/:paymentId/descartar', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), descartarMercadopagoHandler);
router.post('/mercadopago-sin-vincular/:paymentId/crear-egreso', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), crearEgresoDesdeMercadopagoHandler);
router.get('/conciliacion-mercadopago', protect, authorize(PERMISOS.MOVIMIENTOS_READ), conciliacionMercadopagoHandler);
router.get('/resumen-por-categoria', protect, authorize(PERMISOS.MOVIMIENTOS_READ), resumenPorCategoriaHandler);
router.get('/resumen-por-categoria-mensual', protect, authorize(PERMISOS.MOVIMIENTOS_READ), resumenPorCategoriaMensualHandler);
router.get('/resumen-por-categoria/detalle', protect, authorize(PERMISOS.MOVIMIENTOS_READ), resumenPorCategoriaDetalleHandler);
router.get('/mercadopago-descartados', protect, authorize(PERMISOS.MOVIMIENTOS_READ), getMercadopagoDescartadosHandler);
router.post('/mercadopago-sugerencia', protect, authorize(PERMISOS.MOVIMIENTOS_READ), sugerirMercadopagoHandler);
router.delete('/mercadopago-descartados/:paymentId', protect, authorize(PERMISOS.MOVIMIENTOS_WRITE), restaurarMercadopagoDescartadoHandler);
// Al final de los GET: '/:id' captura cualquier segmento, así que tiene que ir
// después de todas las rutas fijas (mercadopago-sin-vincular, resumen-por-categoria, etc.).
router.get('/:id', protect, authorize(PERMISOS.MOVIMIENTOS_READ), getMovimientoByIdHandler);

export default router;
