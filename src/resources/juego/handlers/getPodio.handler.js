import JuegoPuntaje from '../models/JuegoPuntaje.js';
import JuegoPuntajeSemanal from '../models/JuegoPuntajeSemanal.js';
import { semanaKeyArgentina } from '../../../services/fechaArgentina.js';

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 10;

/**
 * @openapi
 * /api/juego/podio:
 *   get:
 *     summary: Podio total y semanal del mini-juego "Escalada Infinita", del club
 *     description: El podio semanal es de la semana en curso (lunes a domingo, hora argentina) — arranca vacío en cuanto empieza una semana nueva, sin perder el histórico total.
 *     tags: [Juego]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 10, maximum: 50 }
 *     responses:
 *       200:
 *         description: Listas ordenadas de mayor a menor puntaje
 *       500:
 *         description: Error al obtener el podio
 */
export const getPodioHandler = async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const clubId = req.user.clubId;
    const userId = String(req.user.id);
    const semana = semanaKeyArgentina(new Date());

    const [podioTotal, podioSemanal, miTotal, miSemanal] = await Promise.all([
      JuegoPuntaje.find({ clubId }).sort({ score: -1 }).limit(limit).select('userId socioId nombre apellido score').lean(),
      JuegoPuntajeSemanal.find({ clubId, semana }).sort({ score: -1 }).limit(limit).select('userId socioId nombre apellido score').lean(),
      JuegoPuntaje.findOne({ clubId, userId }).select('score').lean(),
      JuegoPuntajeSemanal.findOne({ clubId, userId, semana }).select('score').lean(),
    ]);

    return res.status(200).json({
      podioTotal,
      podioSemanal,
      miMejorPuntaje: miTotal?.score ?? 0,
      miMejorPuntajeSemanal: miSemanal?.score ?? 0,
      semana,
    });
  } catch (error) {
    console.error('Error obteniendo el podio del juego:', error);
    return res.status(500).json({ message: 'Error al obtener el podio' });
  }
};

export default getPodioHandler;
