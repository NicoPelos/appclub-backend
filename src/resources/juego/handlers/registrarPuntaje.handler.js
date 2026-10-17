import JuegoPuntaje from '../models/JuegoPuntaje.js';
import JuegoPuntajeSemanal from '../models/JuegoPuntajeSemanal.js';
import Socio from '../../socios/models/Socio.js';
import User from '../../usuarios/models/User.js';
import { semanaKeyArgentina } from '../../../services/fechaArgentina.js';

// Actualiza el mejor puntaje de `modelo` para (clubId, userId[, semana]) solo
// si `score` lo supera — comparte la misma lógica de "record" entre el podio
// total (sin `extra`) y el semanal (`extra: { semana }`).
const actualizarSiMejora = async (modelo, filtro, datos, score) => {
  const existente = await modelo.findOne(filtro);
  if (!existente) {
    await modelo.create({ ...filtro, ...datos, score });
    return { mejoro: true, mejorPuntaje: score };
  }
  if (score > existente.score) {
    existente.score = score;
    existente.nombre = datos.nombre;
    existente.apellido = datos.apellido;
    existente.socioId = datos.socioId;
    await existente.save();
    return { mejoro: true, mejorPuntaje: score };
  }
  return { mejoro: false, mejorPuntaje: existente.score };
};

/**
 * @openapi
 * /api/juego/puntaje:
 *   post:
 *     summary: Registrar un puntaje del mini-juego "Escalada Infinita"
 *     description: Actualiza el podio total y el de la semana en curso, cada uno solo si el puntaje supera el mejor guardado — no es un historial de partidas.
 *     tags: [Juego]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [score]
 *             properties:
 *               score:
 *                 type: integer
 *                 minimum: 0
 *     responses:
 *       200:
 *         description: Puntaje procesado (haya mejorado el récord o no)
 *       400:
 *         description: score inválido
 *       500:
 *         description: Error al registrar el puntaje
 */
export const registrarPuntajeHandler = async (req, res) => {
  try {
    const score = Number(req.body?.score);
    if (!Number.isInteger(score) || score < 0) {
      return res.status(400).json({ message: 'score debe ser un entero mayor o igual a cero' });
    }

    const clubId = req.user.clubId;
    const userId = String(req.user.id);
    const socioId = req.user.socioId || null;

    let nombre = '';
    let apellido = '';
    if (socioId) {
      const socio = await Socio.findOne({ _id: socioId, clubId }).select('nombre apellido').lean();
      if (socio) { nombre = socio.nombre; apellido = socio.apellido; }
    }
    if (!nombre) {
      const user = await User.findById(userId).select('nombre').lean();
      nombre = user?.nombre || req.user.email || 'Jugador';
    }

    const datos = { nombre, apellido, socioId };
    const semana = semanaKeyArgentina(new Date());

    const [total, semanal] = await Promise.all([
      actualizarSiMejora(JuegoPuntaje, { clubId, userId }, datos, score),
      actualizarSiMejora(JuegoPuntajeSemanal, { clubId, userId, semana }, datos, score),
    ]);

    return res.status(200).json({
      mejoro: total.mejoro,
      mejorPuntaje: total.mejorPuntaje,
      mejoroSemanal: semanal.mejoro,
      mejorPuntajeSemanal: semanal.mejorPuntaje,
    });
  } catch (error) {
    console.error('Error registrando puntaje del juego:', error);
    return res.status(500).json({ message: 'Error al registrar el puntaje' });
  }
};

export default registrarPuntajeHandler;
