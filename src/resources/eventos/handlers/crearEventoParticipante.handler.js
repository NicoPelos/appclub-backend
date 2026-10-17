import mongoose from 'mongoose';
import Evento from '../models/Evento.js';
import EventoParticipante from '../models/EventoParticipante.js';
import Socio from '../../socios/models/Socio.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/eventos/{eventoId}/participantes:
 *   post:
 *     summary: Agregar un participante a un evento (socio existente o nombre suelto)
 *     tags: [Eventos]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: eventoId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               socioId:
 *                 type: string
 *                 description: Si se manda, el participante es ese socio (excluyente con nombre/apellido)
 *               nombre: { type: string }
 *               apellido: { type: string }
 *               monto:
 *                 type: number
 *                 description: Monto esperado — si no se manda, usa Evento.precioSugerido
 *               notas:
 *                 type: string
 *                 description: Detalle libre (talle, modelo, etc.), opcional
 *     responses:
 *       201:
 *         description: Participante agregado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Evento o socio no encontrado
 *       409:
 *         description: El evento está cerrado, o el socio ya está en el roster
 *       500:
 *         description: Error al agregar el participante
 */
export const crearEventoParticipanteHandler = async (req, res) => {
  try {
    const { eventoId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(eventoId)) return res.status(400).json({ message: 'ID de evento inválido' });

    const evento = await Evento.findOne({ _id: eventoId, clubId: req.user.clubId, active: true });
    if (!evento) return res.status(404).json({ message: 'Evento no encontrado' });
    if (evento.estado === 'cerrado') return res.status(409).json({ message: 'El evento está cerrado, no se pueden agregar participantes' });

    const { socioId, monto, notas } = req.body;
    let { nombre, apellido } = req.body;

    if (socioId && (nombre || apellido)) {
      return res.status(400).json({ message: 'Indicá socioId O nombre/apellido, no ambos' });
    }

    let resolvedSocioId = null;
    if (socioId) {
      if (!mongoose.Types.ObjectId.isValid(socioId)) return res.status(400).json({ message: 'socioId inválido' });
      const socio = await Socio.findOne({ _id: socioId, clubId: req.user.clubId, active: true });
      if (!socio) return res.status(404).json({ message: 'Socio no encontrado' });

      const yaEsta = await EventoParticipante.findOne({ eventoId, socioId, active: true });
      if (yaEsta) return res.status(409).json({ message: 'Ese socio ya está en el roster de este evento' });

      resolvedSocioId = socio._id;
      nombre = socio.nombre;
      apellido = socio.apellido;
    } else {
      if (!String(nombre || '').trim()) return res.status(400).json({ message: 'Indicá socioId o nombre (para un participante que no es socio)' });
    }

    let montoEsperado = monto;
    if (montoEsperado === undefined || montoEsperado === null) montoEsperado = evento.precioSugerido;
    if (montoEsperado === undefined || montoEsperado === null) {
      return res.status(400).json({ message: 'Indicá un monto — este evento no tiene un precio sugerido configurado' });
    }
    montoEsperado = Number(montoEsperado);
    if (!Number.isFinite(montoEsperado) || montoEsperado < 0) {
      return res.status(400).json({ message: 'monto debe ser un número mayor o igual a cero' });
    }

    const actor = getActor(req);
    const participante = new EventoParticipante({
      clubId: req.user.clubId,
      eventoId,
      socioId: resolvedSocioId,
      nombre: nombre.trim(),
      apellido: (apellido || '').trim(),
      notas: (notas || '').trim(),
      montoEsperadoSnapshot: montoEsperado,
      createdBy: actor,
      updatedBy: actor,
    });

    await participante.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'EventoParticipante', resourceId: participante._id, before: null, after: participante.toObject() });
    return res.status(201).json(participante);
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ message: 'Ese socio ya está en el roster de este evento' });
    console.error('Error agregando participante al evento:', error);
    return res.status(500).json({ message: 'Error al agregar el participante' });
  }
};

export default crearEventoParticipanteHandler;
