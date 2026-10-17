import Asistencia from '../../asistencias/models/Asistencia.js';
import Movimiento from '../../movimientos/models/Movimiento.js';
import mongoose from 'mongoose';
import { logAudit } from '../../audit/services/audit.service.js';
import { anularCuotaMuroLibreMensual } from '../services/registrarMuroLibre.service.js';
import { getActor } from '../../../services/getActor.js';

/**
 * @openapi
 * /api/muro-libre/{id}:
 *   delete:
 *     summary: Anular registro de muro libre (soft delete)
 *     tags: [MuroLibre]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Registro anulado
 *       404:
 *         description: Registro no encontrado
 *       500:
 *         description: Error al anular registro
 */
export const deleteMuroLibreHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let resultado;
    let registroAntes = null;
    await session.withTransaction(async () => {
      const { id } = req.params;
      const actor = getActor(req);

      const registro = await Asistencia.findOne({
        _id: id, clubId: req.user.clubId, tipo: 'muro_libre', active: true,
      }).session(session);

      if (!registro) {
        return res.status(404).json({ message: 'Registro no encontrado' });
      }
      registroAntes = registro.toObject();

      registro.active = false;
      registro.updatedBy = actor;
      await registro.save({ session });

      if (registro.movimientoId) {
        await Movimiento.findByIdAndUpdate(
          registro.movimientoId,
          { active: false, updatedBy: actor },
          { session },
        );

        // appcarc-backend#153 — ver el comentario en anularCuotaMuroLibreMensual.
        await anularCuotaMuroLibreMensual({
          clubId: req.user.clubId, movimientoId: registro.movimientoId, actor, session,
        });
      }

      resultado = registro;
    });

    if (resultado) {
      logAudit({ clubId: req.user?.clubId, req, action: 'DELETE', resource: 'Asistencia', resourceId: resultado._id, before: registroAntes, after: null });
      return res.status(200).json({ message: 'Registro anulado correctamente' });
    }
  } catch (error) {
    console.error('Error anulando muro libre:', error);
    return res.status(500).json({ message: 'Error al anular registro' });
  } finally {
    session.endSession();
  }
};

export default deleteMuroLibreHandler;
