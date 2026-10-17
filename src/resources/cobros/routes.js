import express from 'express';
import { protect, authorize, authorizeSelfYVinculadosOr } from '../../middleware/auth.js';
import { PERMISOS } from '../../constants/permisos.js';
import { createCobroHandler } from './handlers/createCobro.handler.js';
import { getCobrosHandler } from './handlers/getCobros.handler.js';
import { anularCobroHandler } from './handlers/anularCobro.handler.js';
import { cambiarFormaPagoCobroHandler } from './handlers/cambiarFormaPagoCobro.handler.js';

const router = express.Router();

// cobros:precio-historico depende de un campo del body, no de la ruta
// (appcarc-backend#285): se exige solo cuando se pide cobrar a precio de cada
// mes. registrarCobro rechaza cualquier modoPrecio que no sea exactamente
// 'actual' o 'historico', así que no hay forma de pedir el modo histórico sin
// pasar por acá.
const authorizePrecioHistorico = (req, res, next) => (
  req.body?.modoPrecio === 'historico'
    ? authorize(PERMISOS.COBROS_PRECIO_HISTORICO)(req, res, next)
    : next()
);

/**
 * @openapi
 * /api/cobros:
 *   get:
 *     summary: Obtener cobros registrados
 *     tags: [Cobros]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: socioId
 *         schema:
 *           type: string
 *         required: false
 *         description: Filtrar cobros que incluyan cuotas de este socio. Si se omite, un usuario sin permiso de staff ve los suyos propios (los del su perfil y los de sus hijos vinculados).
 *     responses:
 *       200:
 *         description: Lista de cobros disponible
 */
router.get('/', protect, authorizeSelfYVinculadosOr(PERMISOS.COBROS_READ), getCobrosHandler);

/**
 * @openapi
 * /api/cobros:
 *   post:
 *     summary: Registrar un cobro de cuotas y su movimiento de caja
 *     tags: [Cobros]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - paymentMethod
 *               - items
 *             properties:
 *               responsable:
 *                 type: string
 *               paymentMethod:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *               description:
 *                 type: string
 *               date:
 *                 type: string
 *                 format: date-time
 *               modoPrecio:
 *                 type: string
 *                 enum: [actual, historico]
 *                 default: actual
 *                 description: "Con qué precio se valúan los items de suscripción. 'historico' (precio que regía cada mes) requiere el permiso cobros:precio-historico (si no, 403) y motivoPrecioHistorico; el importe de cada mes lo calcula el servidor y un amount en esos items da 400. Si algún mes no tiene precio cargado, 400 nombrando el mes. No afecta cargos puntuales ni Muro Libre."
 *               motivoPrecioHistorico:
 *                 type: string
 *                 description: Obligatorio con modoPrecio 'historico' (mínimo 10 caracteres sin contar espacios). Se ignora en modo 'actual'.
 *               items:
 *                 type: array
 *                 items:
 *                   type: object
 *                   required:
 *                     - socioId
 *                   properties:
 *                     socioId:
 *                       type: string
 *                     suscripcionId:
 *                       type: string
 *                       description: Requerido junto con periodo/periodos, salvo que se envíe cargoPuntualId
 *                     cargoPuntualId:
 *                       type: string
 *                       description: Alternativa a suscripcionId para saldar un cargo puntual (ej. viaje, inscripción) previamente atribuido en /api/cargos-puntuales
 *                     periodo:
 *                       type: string
 *                       example: "2026-06"
 *                     periodoDesde:
 *                       type: string
 *                       example: "2026-06"
 *                     periodos:
 *                       type: array
 *                       items:
 *                         type: string
 *                     cantidad:
 *                       type: integer
 *                       example: 2
 *                     amount:
 *                       description: Importe unitario confirmado. Si no se envía, se usa el precio vigente. No se acepta en items de suscripción con modoPrecio 'historico'.
 *                       type: number
 *                     precioSugeridoSnapshot:
 *                       type: number
 *                     description:
 *                       type: string
 *     responses:
 *       201:
 *         description: Cobro, cuotas y movimiento creados exitosamente. El cobro devuelve modoPrecio y motivoPrecioHistorico.
 *       400:
 *         description: Datos inválidos (incluye modoPrecio desconocido, falta de motivo, amount en modo histórico o un mes sin precio)
 *       403:
 *         description: Sin cobros:write, o modoPrecio 'historico' sin cobros:precio-historico
 */
router.post('/', protect, authorize(PERMISOS.COBROS_WRITE), authorizePrecioHistorico, createCobroHandler);

router.post('/:id/anular', protect, authorize(PERMISOS.COBROS_DELETE), anularCobroHandler);

// Requiere ambos permisos: internamente anula el cobro original (cobros:delete)
// y registra uno nuevo con la forma de pago corregida (cobros:write).
router.put('/:id/forma-pago', protect, authorize(PERMISOS.COBROS_WRITE), authorize(PERMISOS.COBROS_DELETE), cambiarFormaPagoCobroHandler);

export default router;
