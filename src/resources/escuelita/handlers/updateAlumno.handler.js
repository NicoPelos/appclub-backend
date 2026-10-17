import mongoose from 'mongoose';
import Escuelita from '../models/Escuelita.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { sincronizarSuscripcionEscuelita } from '../services/sincronizarSuscripcionPlan.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/escuelita/{id}:
 *   put:
 *     summary: Actualizar información de un alumno de escuelita
 *     tags: [Escuelita]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         schema:
 *           type: string
 *         required: true
 *         description: ID del alumno de escuelita a actualizar
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AlumnoUpdateRequest'
 *     responses:
 *       200:
 *         description: Alumno de escuelita actualizado exitosamente
 *       400:
 *         description: Error en los datos enviados para actualizar el alumno de escuelita
 *       404:
 *         description: Alumno de escuelita no encontrado
 *       500:
 *         description: Error al actualizar alumno de escuelita
 *
 * components:
 *   schemas:
 *     AlumnoUpdateRequest:
 *       type: object
 *       properties:
 *         fechaInscripcion:
 *           type: string
 *           format: date-time
 *           description: Fecha de inscripción del alumno en escuelita
 *         observaciones:
 *           type: string
 *           description: Observaciones adicionales sobre el alumno de escuelita (opcional)
 */

export const updateAlumnoHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const updates = {};
    const { fechaInscripcion, observaciones, planId } = req.body;

    if (fechaInscripcion !== undefined) {
      const inscriptionDate = new Date(fechaInscripcion);
      if (Number.isNaN(inscriptionDate.getTime())) {
        return res.status(400).json({ message: 'La fecha de inscripción es inválida' });
      }
      updates.fechaInscripcion = inscriptionDate;
    }

    if (observaciones !== undefined) {
      updates.observaciones = observaciones;
    }

    if (planId !== undefined) {
      updates.planId = planId || null;
    }

    updates.updatedBy = getActor(req);

    const alumnoAntes = await Escuelita.findOne({ _id: req.params.id, clubId: req.user?.clubId, active: true }).lean();
    if (!alumnoAntes) return res.status(404).json({ message: 'Alumno de escuelita no encontrado' });

    let alumno;
    await session.withTransaction(async () => {
      alumno = await Escuelita.findOneAndUpdate(
        { _id: req.params.id, clubId: req.user?.clubId, active: true },
        updates,
        { returnDocument: 'after', session },
      );

      if (!alumno) {
        const error = new Error('Alumno de escuelita no encontrado');
        error.status = 404;
        throw error;
      }

      // El plan de escuelita determina qué se cobra: si cambia (o se quita),
      // hay que mantener sincronizada la Suscripcion de cobro correspondiente
      // (ver appcarc-backend#12).
      if (planId !== undefined) {
        await sincronizarSuscripcionEscuelita({
          clubId: req.user.clubId,
          socioId: alumno.socioId,
          planId: updates.planId,
          req,
          session,
        });
      }
    });

    await alumno.populate('socioId', 'socioNumber nombre apellido dni correoElectronico telefono estado active');
    await alumno.populate('planId', 'nombre tipo modalidad atributos');

    logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Escuelita', resourceId: alumno._id, before: alumnoAntes, after: alumno.toObject() });
    res.status(200).json(alumno);
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error actualizando alumno de escuelita:', error);
    res.status(500).json({ message: 'Error al actualizar alumno de escuelita' });
  } finally {
    session.endSession();
  }
};

export default updateAlumnoHandler;
