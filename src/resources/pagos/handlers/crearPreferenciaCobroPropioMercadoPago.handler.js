import { BusinessError, crearPreferenciaCobroPropioMercadoPago } from '../services/crearPreferenciaCobroPropioMercadoPago.service.js';
import { MENSAJE_LINK_SOLO_PRECIO_ACTUAL, linkDePagoAdmiteModoPrecio } from '../services/modoPrecioLinkDePago.js';

/**
 * @openapi
 * /api/pagos/mercadopago/preferencia-propia:
 *   post:
 *     summary: Generar un link de pago de Mercado Pago para el usuario autenticado y/o sus vínculos
 *     description: >
 *       El usuario elige QUÉ ítems pendientes pagar (períodos de cuota, un
 *       cargo puntual, visitas de Muro Libre) de su propio perfil y/o de sus
 *       hijos vinculados (ver VinculoFamiliar), en un mismo link — pero nunca
 *       el monto: los importes se resuelven siempre en el servidor (precio
 *       vigente o snapshot ya guardado), ignorando cualquier "amount" que
 *       pueda venir en el body. Cada item indica su propio socioId, validado
 *       contra los perfiles realmente accesibles del usuario.
 *     tags: [Pagos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [items]
 *             properties:
 *               modoPrecio:
 *                 type: string
 *                 enum: [actual]
 *                 description: "Opcional (ausente o null equivale a 'actual'). El link de pago siempre cobra al precio actual: cualquier otro valor (por ejemplo 'historico') da 400. Para cobrar a precio de cada mes se usa POST /api/cobros con efectivo o transferencia (#285)."
 *               items:
 *                 type: array
 *                 minItems: 1
 *                 items:
 *                   type: object
 *                   required: [socioId]
 *                   properties:
 *                     socioId: { type: string }
 *                     suscripcionId: { type: string }
 *                     periodos:
 *                       type: array
 *                       items: { type: string }
 *                     cargoPuntualId: { type: string }
 *                     muroLibrePendiente: { type: boolean }
 *     responses:
 *       201:
 *         description: Preferencia creada
 *       400:
 *         description: "Datos inválidos, club sin Mercado Pago configurado, o modoPrecio distinto de 'actual' (mensaje: 'El link de pago siempre cobra al precio actual. Para cobrar a precio de cada mes, registrá el cobro como efectivo o transferencia.')"
 *       401:
 *         description: El usuario autenticado no tiene ningún perfil de socio asociado
 *       403:
 *         description: Un item indica un socioId que no es un perfil accesible del usuario
 *       404:
 *         description: Ítem no encontrado para el socio
 *       409:
 *         description: El ítem ya está pagado
 *       502:
 *         description: Error comunicándose con Mercado Pago
 */
export const crearPreferenciaCobroPropioMercadoPagoHandler = async (req, res) => {
  if (!linkDePagoAdmiteModoPrecio(req.body)) {
    return res.status(400).json({ message: MENSAJE_LINK_SOLO_PRECIO_ACTUAL });
  }

  try {
    const result = await crearPreferenciaCobroPropioMercadoPago({
      clubId: req.user?.clubId,
      requestedByUserId: req.user?.id,
      requestedByEmail: req.user?.email,
      items: req.body?.items,
    });

    res.status(201).json(result);
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message, ...(error.data ?? {}) });
    }

    console.error('Error generando link de pago propio de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al generar el link de pago' });
  }
};

