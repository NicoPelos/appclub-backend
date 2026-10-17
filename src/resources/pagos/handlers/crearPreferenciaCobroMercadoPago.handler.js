import { BusinessError, crearPreferenciaCobroMercadoPago } from '../services/crearPreferenciaCobroMercadoPago.service.js';
import { MENSAJE_LINK_SOLO_PRECIO_ACTUAL, linkDePagoAdmiteModoPrecio } from '../services/modoPrecioLinkDePago.js';

/**
 * @openapi
 * /api/pagos/mercadopago/preferencia-cobro:
 *   post:
 *     summary: Generar un link de pago de Mercado Pago para un cobro armado por secretaría (admin o secretaria)
 *     description: >
 *       Toma los mismos items que /api/cobros (cuotas, cargos puntuales, muro libre) con
 *       los montos ya confirmados en Registrar Cobro, y genera una preferencia de pago
 *       para compartir por WhatsApp. El cobro real recién se registra cuando el webhook
 *       de Mercado Pago confirma el pago aprobado.
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [socioId, items]
 *             properties:
 *               socioId:
 *                 type: string
 *               description:
 *                 type: string
 *               modoPrecio:
 *                 type: string
 *                 enum: [actual]
 *                 description: "Opcional (ausente o null equivale a 'actual'). El link de pago siempre cobra al precio actual: cualquier otro valor (por ejemplo 'historico') da 400. Para cobrar a precio de cada mes se usa POST /api/cobros con efectivo o transferencia (#285)."
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [socioId, amount]
 *                   properties:
 *                     socioId: { type: string }
 *                     suscripcionId: { type: string }
 *                     cargoPuntualId: { type: string }
 *                     muroLibrePendiente: { type: boolean }
 *                     periodos:
 *                       type: array
 *                       items: { type: string }
 *                     cantidad: { type: integer }
 *                     amount:
 *                       type: number
 *                       description: Requerido — Mercado Pago necesita un monto concreto antes de que exista el cobro.
 *                     description: { type: string }
 *     responses:
 *       201:
 *         description: Preferencia creada
 *       400:
 *         description: "Datos inválidos, club sin Mercado Pago configurado, o modoPrecio distinto de 'actual' (mensaje: 'El link de pago siempre cobra al precio actual. Para cobrar a precio de cada mes, registrá el cobro como efectivo o transferencia.')"
 *       404:
 *         description: Socio no encontrado
 *       502:
 *         description: Error comunicándose con Mercado Pago
 */
export const crearPreferenciaCobroMercadoPagoHandler = async (req, res) => {
  if (!linkDePagoAdmiteModoPrecio(req.body)) {
    return res.status(400).json({ message: MENSAJE_LINK_SOLO_PRECIO_ACTUAL });
  }

  try {
    const result = await crearPreferenciaCobroMercadoPago({
      clubId: req.user?.clubId,
      requestedByUserId: req.user?.id,
      requestedByEmail: req.user?.email,
      socioId: req.body?.socioId,
      items: req.body?.items,
      description: req.body?.description,
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message });
    }

    console.error('Error generando link de pago de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al generar el link de pago' });
  }
};

