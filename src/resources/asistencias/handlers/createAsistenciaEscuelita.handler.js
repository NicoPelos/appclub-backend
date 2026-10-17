import {
  BusinessError,
  registrarAsistenciaEscuelita,
} from '../services/registrarAsistenciaEscuelita.service.js';
import { resolveSocioFromQrTokenOrDni } from '../../socios/services/socioQr.service.js';

/**
 * @openapi
 * /api/asistencias/escuelita:
 *   post:
 *     summary: Registrar presente en escuelita
 *     tags: [Asistencias]
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
 *               socioId:
 *                 type: string
 *                 description: ID del socio (alternativa a token/DNI)
 *               categoria:
 *                 type: string
 *                 description: Categoría de la clase (ej. niños, adultos, avanzados)
 *               fecha:
 *                 type: string
 *                 format: date-time
 *               observaciones:
 *                 type: string
 *     responses:
 *       201:
 *         description: Asistencia registrada exitosamente
 *       400:
 *         description: Socio no inscripto en escuelita o datos inválidos
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al registrar asistencia
 */
export const createAsistenciaEscuelitaHandler = async (req, res) => {
  try {
    const { token, dni, ...rest } = req.body;

    let socioId = rest.socioId;

    if (token || dni) {
      const { socio } = await resolveSocioFromQrTokenOrDni({
        token,
        dni,
        clubId: req.user?.clubId,
        missingMessage: 'Se requiere token QR, DNI o socioId',
      });
      socioId = String(socio._id);
    }

    if (!socioId) {
      return res.status(400).json({ message: 'Se requiere token QR, DNI o socioId' });
    }

    const asistencia = await registrarAsistenciaEscuelita({
      clubId: req.user?.clubId,
      user: req.user,
      body: { ...rest, socioId },
    });

    res.status(201).json(asistencia);
  } catch (error) {
    if (error instanceof BusinessError || error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error registrando asistencia escuelita:', error);
    res.status(500).json({ message: 'Error al registrar asistencia de escuelita' });
  }
};
