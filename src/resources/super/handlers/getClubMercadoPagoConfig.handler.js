import Club from '../../clubs/models/Club.js';
import MercadoPagoConfig from '../../pagos/models/MercadoPagoConfig.js';

/**
 * @openapi
 * /super/clubs/{id}/mercadopago:
 *   get:
 *     summary: Obtener la configuración de Mercado Pago de un club (sin los secretos)
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Configuración (o null si no está configurado)
 *       404:
 *         description: Club no encontrado
 */
export const getClubMercadoPagoConfigHandler = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id).lean();
    if (!club) return res.status(404).json({ message: 'Club no encontrado' });

    // accessToken y webhookSecret son write-only: nunca se devuelven en texto plano.
    const config = await MercadoPagoConfig.findOne({ clubId: club.slug }, '-accessToken -webhookSecret').lean();

    res.status(200).json(config ?? null);
  } catch (error) {
    console.error('Error obteniendo configuración de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al obtener configuración de Mercado Pago' });
  }
};

