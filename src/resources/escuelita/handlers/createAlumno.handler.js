import mongoose from 'mongoose';
import Socio from '../../socios/models/Socio.js';
import Escuelita from '../models/Escuelita.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { sincronizarSuscripcionEscuelita } from '../services/sincronizarSuscripcionPlan.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/escuelita:
 *   post:
 *     summary: Inscribir un nuevo alumno en escuelita
 *     tags: [Escuelita]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AlumnoRequest'
 *     responses:
 *       201:
 *         description: Alumno de escuelita creado exitosamente
 *       400:
 *         description: Error en los datos enviados para crear el alumno de escuelita
 *       404:
 *         description: Socio no encontrado o inactivo
 *       409:
 *         description: El socio ya está inscripto en escuelita
 *       500:
 *         description: Error al crear alumno de escuelita
 *
 * components:
 *   schemas:
 *     AlumnoRequest:
 *       type: object
 *       required:
 *         - socioId
 *       properties:
 *         socioId:
 *           type: string
 *           description: ID del socio a inscribir en escuelita
 *         fechaInscripcion:
 *           type: string
 *           format: date-time
 *           description: Fecha de inscripción del alumno. Si no se envía, se usa la fecha actual.
 *         observaciones:
 *           type: string
 *           description: Observaciones adicionales sobre el alumno de escuelita (opcional)
 */

export const createAlumnoHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const { socioId, fechaInscripcion, observaciones = '', planId } = req.body;

    if (!socioId) {
      return res.status(400).json({ message: 'socioId es obligatorio' });
    }

    const socio = await Socio.findOne({ _id: socioId, clubId: req.user?.clubId, active: true });
    if (!socio) {
      return res.status(404).json({ message: 'El socio no existe, está inactivo o pertenece a otro club' });
    }

    const existing = await Escuelita.findOne({ clubId: req.user.clubId, socioId, active: true });
    if (existing) {
      return res.status(409).json({ message: 'El socio ya está inscripto en escuelita' });
    }

    const inscriptionDate = fechaInscripcion ? new Date(fechaInscripcion) : new Date();
    if (Number.isNaN(inscriptionDate.getTime())) {
      return res.status(400).json({ message: 'La fecha de inscripción es inválida' });
    }

    let alumno;
    await session.withTransaction(async () => {
      alumno = new Escuelita({
        clubId: req.user.clubId,
        socioId,
        dni: socio.dni || '',
        fechaInscripcion: inscriptionDate,
        planId: planId || null,
        observaciones,
        createdBy: getActor(req),
        updatedBy: getActor(req),
      });

      await alumno.save({ session });

      // Si se inscribe directamente con un plan asignado, también hay que
      // crear la Suscripcion de cobro correspondiente (ver appcarc-backend#12).
      if (planId) {
        await sincronizarSuscripcionEscuelita({
          clubId: req.user.clubId,
          socioId: alumno.socioId,
          planId,
          req,
          session,
        });
      }
    });

    await alumno.populate('socioId', 'socioNumber nombre apellido dni correoElectronico telefono estado active');
    await alumno.populate('planId', 'nombre tipo modalidad atributos');

    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Escuelita', resourceId: alumno._id, before: null, after: alumno.toObject() });
    res.status(201).json(alumno);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error creando alumno de escuelita:', error);
    res.status(500).json({ message: 'Error al crear alumno de escuelita' });
  } finally {
    session.endSession();
  }
};

export default createAlumnoHandler;
