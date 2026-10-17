import { sugerirMovimientoParaPago } from '../services/sugerirMercadopago.service.js';

/**
 * @openapi
 * /api/movimientos/mercadopago-sugerencia:
 *   post:
 *     summary: Motor único de sugerencias Movimiento↔Mercado Pago (appcarc-backend#274) — dado un pago, sugiere vincularlo a un Movimiento existente o crear uno nuevo. Nunca escribe nada, solo sugiere. Pensado para alimentarse tanto de la API de pagos como de una fila del reporte "Estado de cuenta" o una captura leída a mano (de ahí que payerEmail/payerName sean opcionales e independientes).
 *     tags: [Movimientos]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [monto, fecha]
 *             properties:
 *               monto: { type: number }
 *               fecha: { type: string, format: date-time }
 *               payerEmail: { type: string }
 *               payerName: { type: string }
 *               direccion: { type: string, enum: [ingreso, egreso], default: ingreso }
 *     responses:
 *       200:
 *         description: "{ tipo: 'vincular'|'revisar'|'crear', candidatos?, datosSugeridos? }"
 *       400:
 *         description: Faltan monto y/o fecha
 */
export const sugerirMercadopagoHandler = async (req, res) => {
  try {
    const { monto, fecha, payerEmail = '', payerName = '', direccion = 'ingreso' } = req.body ?? {};
    if (monto == null || !fecha) return res.status(400).json({ message: 'Faltan monto y fecha' });

    const resultado = await sugerirMovimientoParaPago({
      clubId: req.user?.clubId, monto, fecha, payerEmail, payerName, direccion,
    });
    res.json(resultado);
  } catch (error) {
    console.error('Error generando sugerencia de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al generar la sugerencia' });
  }
};

export default sugerirMercadopagoHandler;
