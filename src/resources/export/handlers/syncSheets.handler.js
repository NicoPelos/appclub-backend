import { exportToSheets } from '../../../services/sheetsExport.service.js';
import Club from '../../clubs/models/Club.js';

/**
 * @openapi
 * /api/export/sheets:
 *   post:
 *     summary: Exportar datos del club a Google Sheets (solo admin)
 *     tags: [Export]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Exportación completada
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 url:
 *                   type: string
 *                   description: URL del Google Sheet generado
 *                 stats:
 *                   type: object
 *                   description: Cantidad de filas exportadas por pestaña
 *       500:
 *         description: Error al exportar
 */
export const syncSheetsHandler = async (req, res) => {
  try {
    const clubId = req.user.clubId;
    const club = await Club.findOne({ slug: clubId });

    if (!club?.modulos?.exportSheets) {
      return res.status(403).json({ message: 'La exportación a Sheets no está habilitada para este club' });
    }

    const clubName = club?.nombre || clubId;

    const result = await exportToSheets({ clubId, clubName, spreadsheetId: club?.integraciones?.sheets?.spreadsheetId });

    if (club && club.integraciones?.sheets?.spreadsheetId !== result.spreadsheetId) {
      club.integraciones.sheets.spreadsheetId = result.spreadsheetId;
      await club.save();
    }

    return res.status(200).json({
      message: 'Exportación completada',
      url: result.url,
      stats: result.stats,
    });
  } catch (error) {
    console.error('Error exportando a Google Sheets:', error);
    return res.status(500).json({ message: 'Error al exportar a Google Sheets', detail: error.message });
  }
};
