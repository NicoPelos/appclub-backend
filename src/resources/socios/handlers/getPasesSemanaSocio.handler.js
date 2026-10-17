import Socio from '../models/Socio.js';
import { pasesIncluidosSemana } from '../../muroLibre/services/pasesClases.service.js';

/**
 * @openapi
 * /api/socios/{id}/pases-semana:
 *   get:
 *     summary: Pases de muro libre que le quedan al socio esta semana (lunes a domingo)
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: "max, usados, restantes y proximaRenovacion" }
 *       404: { description: Socio no encontrado }
 */
export const getPasesSemanaSocioHandler = async (req, res) => {
  try {
    const clubId = req.user?.clubId;
    const socio = await Socio.findOne({ _id: req.params.id, clubId, active: true }).select('_id').lean();
    if (!socio) return res.status(404).json({ message: 'Socio no encontrado' });

    const pases = await pasesIncluidosSemana({ clubId, socioId: socio._id, fecha: new Date() });
    res.status(200).json(pases);
  } catch (error) {
    console.error('Error obteniendo pases de la semana:', error);
    res.status(500).json({ message: 'Error al obtener los pases de la semana' });
  }
};

export default getPasesSemanaSocioHandler;
