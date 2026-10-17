import Club from '../../clubs/models/Club.js';
import MercadoPagoConfig from '../../pagos/models/MercadoPagoConfig.js';

/**
 * @openapi
 * /super/clubs/{id}/mercadopago:
 *   put:
 *     summary: Crear o actualizar la configuración de Mercado Pago de un club
 *     tags: [Super]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               accessToken:
 *                 type: string
 *                 description: Write-only. Si se omite, se conserva el ya guardado.
 *               webhookSecret:
 *                 type: string
 *                 description: Write-only. El club lo obtiene al configurar el webhook en su cuenta de MP.
 *               publicKey:
 *                 type: string
 *               active:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Configuración guardada (sin los secretos)
 *       400:
 *         description: accessToken es obligatorio para configurar por primera vez
 *       404:
 *         description: Club no encontrado
 */
export const updateClubMercadoPagoConfigHandler = async (req, res) => {
  try {
    const club = await Club.findById(req.params.id).lean();
    if (!club) return res.status(404).json({ message: 'Club no encontrado' });

    const { accessToken, webhookSecret, publicKey, active } = req.body;

    const existing = await MercadoPagoConfig.findOne({ clubId: club.slug });

    if (!existing && !accessToken) {
      return res.status(400).json({ message: 'accessToken es obligatorio para configurar por primera vez' });
    }

    const update = {
      clubId: club.slug,
      updatedBy: req.user?.email || 'superadmin',
    };
    if (accessToken) update.accessToken = accessToken; // solo se pisa si se mandó uno nuevo
    if (webhookSecret) update.webhookSecret = webhookSecret; // ídem
    if (publicKey !== undefined) update.publicKey = publicKey;
    if (active !== undefined) update.active = active;

    const saved = await MercadoPagoConfig.findOneAndUpdate(
      { clubId: club.slug },
      { $set: update },
      { upsert: true, new: true, runValidators: true },
    ).select('-accessToken -webhookSecret');

    res.status(200).json(saved);
  } catch (error) {
    console.error('Error guardando configuración de Mercado Pago:', error);
    res.status(500).json({ message: 'Error al guardar configuración de Mercado Pago' });
  }
};

