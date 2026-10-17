import { BusinessError, registrarMuroLibre } from '../services/registrarMuroLibre.service.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/muro-libre:
 *   post:
 *     summary: Registrar muro libre
 *     tags: [MuroLibre]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tipoPase
 *             properties:
 *               socioId:
 *                 type: string
 *                 description: ID del socio
 *               esSocio:
 *                 type: boolean
 *                 description: Indica si la persona se registra como socia sin socioId.
 *               nombre:
 *                 type: string
 *                 description: Nombre de la persona. Obligatorio para no socios.
 *               apellido:
 *                 type: string
 *                 description: Apellido de la persona.
 *               dni:
 *                 type: string
 *                 description: DNI de la persona.
 *               tipoPase:
 *                 type: string
 *                 enum: [diario, mensual]
 *                 description: Tipo de pase
 *               estadoPago:
 *                 type: string
 *                 enum: [pagado, pendiente, exento]
 *                 description: Estado de pago
 *               paymentMethod:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *                 description: Forma de pago
 *               amount:
 *                 type: number
 *                 description: Monto confirmado. Si no se envía y el pago es pagado, se usa el precio vigente.
 *               fecha:
 *                 type: string
 *                 format: date-time
 *                 description: Fecha del registro. Si no se envía, usa la fecha actual.
 *               enviarComprobanteWp:
 *                 type: boolean
 *                 description: Indica si se debe enviar comprobante por WhatsApp
 *               observaciones:
 *                 type: string
 *                 description: Observaciones adicionales
 *     responses:
 *       201:
 *         description: Muro libre registrado exitosamente
 *       400:
 *         description: Error en los datos enviados para el registro
 *       500:
 *         description: Error al registrar muro libre
 */

export const createMuroLibreHandler = async (req, res) => {
  try {
    const result = await registrarMuroLibre({
      clubId: req.user?.clubId,
      user: req.user,
      body: req.body,
    });

    res.status(201).json(result);
    if (result?.registro) logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Asistencia', resourceId: result.registro._id, before: null, after: result.registro });
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message, ...(error.data ?? {}) });
    }

    console.error('Error registrando muro libre:', error);
    res.status(500).json({ message: 'Error al registrar muro libre' });
  }
};

export default createMuroLibreHandler;
