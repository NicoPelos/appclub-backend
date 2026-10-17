import { cambiarFormaPagoCobro, BusinessError } from '../services/cambiarFormaPagoCobro.service.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/cobros/{id}/forma-pago:
 *   put:
 *     summary: Corregir la forma de pago de un cobro (anula el cobro original y lo vuelve a cargar con los mismos ítems)
 *     tags: [Cobros]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [paymentMethod]
 *             properties:
 *               paymentMethod:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *     responses:
 *       201:
 *         description: Forma de pago corregida — devuelve el cobro nuevo
 *       400:
 *         description: Datos inválidos, ya está en esa forma de pago, o tiene pagos de Mercado Pago vinculados
 *       404:
 *         description: Cobro no encontrado
 */
export const cambiarFormaPagoCobroHandler = async (req, res) => {
  try {
    const result = await cambiarFormaPagoCobro({
      clubId: req.user?.clubId,
      user: req.user,
      cobroId: req.params.id,
      paymentMethod: req.body?.paymentMethod,
    });

    // El cobro original ya quedó auditado por su propia anulación (dentro de
    // anularCobroConTrazabilidad); esto deja el rastro de que fue reemplazado
    // por este otro, con la forma de pago corregida.
    logAudit({
      clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Cobro', resourceId: req.params.id,
      before: null,
      after: { motivo: 'Corrección de forma de pago', cobroNuevoId: result.cobro._id, paymentMethod: req.body?.paymentMethod },
    });

    return res.status(201).json(result);
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message, ...(error.data ?? {}) });
    }
    console.error('Error cambiando forma de pago del cobro:', error);
    return res.status(500).json({ message: 'Error al cambiar la forma de pago' });
  }
};

export default cambiarFormaPagoCobroHandler;
