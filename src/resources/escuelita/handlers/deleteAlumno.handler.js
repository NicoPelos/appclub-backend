import mongoose from 'mongoose';
import Escuelita from '../models/Escuelita.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { sincronizarSuscripcionEscuelita } from '../services/sincronizarSuscripcionPlan.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/escuelita/{id}:
 *   delete:
 *     summary: Borrar la inscripción de un alumno a escuelita
 *     description: >
 *       Baja lógica (soft-delete, no destruye historial de asistencias/deuda) que
 *       además cierra cualquier Suscripcion de escuelita vigente del socio, para
 *       que no siga generando deuda una vez que ya no está inscripto.
 *     tags: [Escuelita]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: ID de la inscripción a escuelita a borrar
 *     responses:
 *       200:
 *         description: Inscripción borrada exitosamente
 *       404:
 *         description: Alumno de escuelita no encontrado
 *       500:
 *         description: Error al borrar la inscripción
 */
export const deleteAlumnoHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const alumnoAntes = await Escuelita.findOne({ _id: req.params.id, clubId: req.user?.clubId, active: true }).lean();
    if (!alumnoAntes) return res.status(404).json({ message: 'Alumno de escuelita no encontrado' });

    let alumno;
    await session.withTransaction(async () => {
      alumno = await Escuelita.findOneAndUpdate(
        { _id: req.params.id, clubId: req.user?.clubId, active: true },
        { active: false, updatedBy: getActor(req) },
        { returnDocument: 'after', session },
      );

      if (!alumno) {
        const error = new Error('Alumno de escuelita no encontrado');
        error.status = 404;
        throw error;
      }

      // Sin planId (undefined) esta misma función solo cierra cualquier
      // Suscripcion de escuelita vigente del socio, sin asignar una nueva —
      // es el mismo mecanismo que usa updateAlumno al quitar el plan.
      await sincronizarSuscripcionEscuelita({
        clubId: req.user.clubId,
        socioId: alumno.socioId,
        planId: undefined,
        req,
        session,
      });
    });

    logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Escuelita', resourceId: alumno._id, before: alumnoAntes, after: null });
    res.status(200).json({ message: 'Inscripción borrada' });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ message: error.message });
    }
    console.error('Error borrando alumno de escuelita:', error);
    res.status(500).json({ message: 'Error al borrar la inscripción' });
  } finally {
    session.endSession();
  }
};

export default deleteAlumnoHandler;
