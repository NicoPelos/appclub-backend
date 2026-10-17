import { randomBytes } from 'crypto';
import Horarios from '../models/Horarios.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { ROLES_EDIT_ALL, ROLES_READ_ONLY, MAX_TOTAL_HORAS } from '../constants.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/horarios:
 *   post:
 *     summary: Crear un nuevo horario
 *     tags: [Horarios]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [fecha, nombre]
 *             properties:
 *               fecha:
 *                 type: string
 *                 format: date
 *               nombre:
 *                 type: string
 *               horaEntrada:
 *                 type: string
 *                 format: date-time
 *               horaSalida:
 *                 type: string
 *                 format: date-time
 *               totalHoras:
 *                 type: number
 *               observaciones:
 *                 type: string
 *     responses:
 *       201:
 *         description: Horario creado exitosamente
 *       400:
 *         description: Error en los datos enviados
 *       500:
 *         description: Error al crear horario
 */
export const createHorarioHandler = async (req, res) => {
  try {
    const { fecha, horaEntrada, horaSalida, totalHoras, etiquetaId, observaciones } = req.body;

    const canEditAll  = req.user?.roles?.some(r => ROLES_EDIT_ALL.includes(r));
    const isReadOnly  = !canEditAll && req.user?.roles?.some(r => ROLES_READ_ONLY.includes(r));
    if (isReadOnly) return res.status(403).json({ message: 'No tenés permiso para registrar horarios' });
    if (!canEditAll && !req.user?.socioId) {
      return res.status(403).json({ message: 'Tu usuario no tiene un perfil de socio asociado para registrar horarios' });
    }

    if (!fecha) return res.status(400).json({ message: 'La fecha es obligatoria' });
    const fechaDate = new Date(fecha);
    if (isNaN(fechaDate.getTime())) return res.status(400).json({ message: 'La fecha es inválida' });

    if (horaEntrada) {
      const d = new Date(horaEntrada);
      if (isNaN(d.getTime())) return res.status(400).json({ message: 'La hora de entrada es inválida' });
    }

    if (horaSalida) {
      const d = new Date(horaSalida);
      if (isNaN(d.getTime())) return res.status(400).json({ message: 'La hora de salida es inválida' });
    }

    if (totalHoras !== undefined) {
      if (typeof totalHoras !== 'number' || !Number.isFinite(totalHoras) || totalHoras < 0) {
        return res.status(400).json({ message: 'El totalHoras debe ser un número mayor o igual a 0' });
      }
      if (totalHoras > MAX_TOTAL_HORAS) {
        return res.status(400).json({ message: `El totalHoras no puede superar ${MAX_TOTAL_HORAS} horas` });
      }
    }

    if (etiquetaId) {
      const etiqueta = await Etiqueta.findOne({ _id: etiquetaId, clubId: req.user?.clubId, active: true });
      if (!etiqueta) return res.status(404).json({ message: 'Etiqueta no encontrada' });
    }

    const horario = new Horarios({
      idHorarios: randomBytes(4).toString('hex'),
      clubId: req.user?.clubId,
      socioId: canEditAll ? (req.body.socioId ?? null) : req.user.socioId,
      fecha: fechaDate,
      etiquetaId: etiquetaId ?? null,
      horaEntrada: horaEntrada ? new Date(horaEntrada) : undefined,
      horaSalida: horaSalida ? new Date(horaSalida) : undefined,
      totalHoras: totalHoras ?? undefined,
      observaciones: observaciones || '',
      createdBy: getActor(req),
      updatedBy: getActor(req),
    });

    await horario.save();
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Horarios', resourceId: horario._id, before: null, after: horario.toObject() });
    res.status(201).json(horario);
  } catch (error) {
    console.error('Error creando horario:', error);
    res.status(500).json({ message: 'Error al crear horario' });
  }
};
