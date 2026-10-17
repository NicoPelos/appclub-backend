import { generateSocioQrToken, findActiveSocioById } from '../services/socioQr.service.js';


/**
 * @openapi
 * /api/socios/{id}/qr:
 *   get:
 *     summary: Obtener token QR de socio
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         description: ID del socio
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Token QR generado exitosamente
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Token QR del socio
 *                 socioId:
 *                   type: string
 *                   description: ID del socio
 *                 clubId:
 *                   type: string
 *                   description: ID del club al que pertenece el socio
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al generar token QR
 */

export const getSocioQrHandler = async (req, res) => {
  try {
    const { id } = req.params;

    // Solo un usuario que es *únicamente* socio queda limitado a su propio QR: un
    // staff que además es socio conserva el acceso que le da su permiso (#190).
    const soloSocio = req.user?.roles?.length > 0 && req.user.roles.every((r) => r === 'socio');
    if (soloSocio && req.user?.socioId !== id) {
      return res.status(403).json({ message: 'No tenés permiso para ver el QR de otro socio' });
    }

    const socio = await findActiveSocioById(id, req.user?.clubId);
    if (!socio) {
      return res.status(404).json({ message: 'Socio no encontrado' });
    }

    const token = generateSocioQrToken({ clubId: socio.clubId, socioId: socio._id });

    res.status(200).json({ token, socioId: socio._id, clubId: socio.clubId });
  } catch (error) {
    console.error('Error generando QR de socio:', error);
    res.status(error.status || 500).json({ message: error.message || 'Error generando QR' });
  }
};

export default getSocioQrHandler;
