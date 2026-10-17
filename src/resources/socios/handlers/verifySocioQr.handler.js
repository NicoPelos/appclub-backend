import { buildSocioVerificationPayload, resolveSocioFromQrTokenOrDni } from '../services/socioQr.service.js';


/**
 * @openapi
 * /api/socios/verify:
 *   post:
 *     summary: Verificar QR de socio
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token QR del socio
 *               dni:
 *                 type: string
 *                 description: DNI del socio
 *     responses:
 *       200:
 *         description: Socio verificado exitosamente
 *       400:
 *         description: Error en los datos enviados para la verificación
 *       404:
 *         description: Socio no encontrado
 */

export const verifySocioQrHandler = async (req, res) => {
  try {
    const { token, dni } = req.body;

    const { socio } = await resolveSocioFromQrTokenOrDni({
      token,
      dni,
      clubId: req.user?.clubId,
    });

    const payload = await buildSocioVerificationPayload(socio);
    res.status(200).json(payload);
  } catch (error) {
    console.error('Error verificando QR de socio:', error);
    res.status(error.status || 500).json({ message: error.message || 'Error verificando socio' });
  }
};

export default verifySocioQrHandler;
