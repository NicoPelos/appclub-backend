import Asistencia from '../../asistencias/models/Asistencia.js';
import Movimiento from '../../movimientos/models/Movimiento.js';
import Cuota from '../../cuotas/models/Cuota.js';
import mongoose from 'mongoose';
import { logAudit } from '../../audit/services/audit.service.js';
import { esFechaFutura } from '../../../services/fechaArgentina.js';
import { getActor } from '../../../services/getActor.js';

const VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];
// 'pagado' queda afuera a propósito: pasar a/desde pagado implica crear o
// revertir un Movimiento (y, si era pase mensual, la Cuota asociada — ver
// appcarc-backend#153), que este endpoint no maneja. Solo se permite
// alternar entre pendiente y exento, que nunca tuvieron Movimiento (ver
// registrarMuroLibre.service.js: monto se fuerza a 0 en ambos casos).
const ESTADOS_PAGO_EDITABLES = ['pendiente', 'exento'];

/**
 * @openapi
 * /api/muro-libre/{id}:
 *   put:
 *     summary: Editar registro de muro libre (solo admin/secretary)
 *     tags: [MuroLibre]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: id
 *         in: path
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               fecha: { type: string, format: date-time }
 *               monto: { type: number }
 *               formaPago:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *               observaciones: { type: string }
 *               estadoPago:
 *                 type: string
 *                 enum: [pendiente, exento]
 *                 description: Solo se puede alternar entre pendiente y exento — un check-in pagado no se puede cambiar de estado desde acá
 *     responses:
 *       200:
 *         description: Registro actualizado
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Registro no encontrado
 *       500:
 *         description: Error al actualizar registro
 */
export const updateMuroLibreHandler = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    let resultado;
    let registroAntes = null;
    await session.withTransaction(async () => {
      const { id } = req.params;
      const { fecha, monto, formaPago, observaciones, estadoPago } = req.body;
      const actor = getActor(req);

      const registro = await Asistencia.findOne({
        _id: id, clubId: req.user.clubId, tipo: 'muro_libre', active: true,
      }).session(session);

      if (!registro) {
        return res.status(404).json({ message: 'Registro no encontrado' });
      }
      registroAntes = registro.toObject();

      if (fecha !== undefined) {
        const d = new Date(fecha);
        if (isNaN(d.getTime())) {
          return res.status(400).json({ message: 'Fecha inválida' });
        }
        if (esFechaFutura(d)) {
          return res.status(400).json({ message: 'La fecha de la asistencia no puede ser futura' });
        }
        registro.fecha = d;
      }

      if (monto !== undefined) {
        const m = Number(monto);
        if (!Number.isFinite(m) || m < 0) {
          return res.status(400).json({ message: 'Monto inválido' });
        }
        registro.monto = m;

        if (registro.movimientoId) {
          await Movimiento.findByIdAndUpdate(
            registro.movimientoId,
            { amount: m, updatedBy: actor },
            { session },
          );
          // appcarc-backend#186: un pase mensual pagado además generó una
          // Cuota (registrarMuroLibre.service.js) — calcularDeuda.service.js
          // calcula la deuda desde ahí, no desde el Movimiento, así que hay
          // que mantenerla en sync o el socio queda "al día" con un monto
          // que no coincide con lo cobrado (o con saldo pendiente fantasma).
          await Cuota.updateMany(
            { clubId: req.user.clubId, movimientoId: registro.movimientoId },
            { montoPagadoSnapshot: m, updatedBy: actor },
            { session },
          );
        }
      }

      if (formaPago !== undefined) {
        if (!VALID_PAYMENT_METHODS.includes(formaPago)) {
          return res.status(400).json({ message: 'formaPago debe ser Efectivo o Transferencia' });
        }
        registro.formaPago = formaPago;

        if (registro.movimientoId) {
          await Movimiento.findByIdAndUpdate(
            registro.movimientoId,
            { paymentMethod: formaPago, updatedBy: actor },
            { session },
          );
          await Cuota.updateMany(
            { clubId: req.user.clubId, movimientoId: registro.movimientoId },
            { paymentMethod: formaPago, updatedBy: actor },
            { session },
          );
        }
      }

      if (observaciones !== undefined) {
        registro.observaciones = String(observaciones).trim();
      }

      if (estadoPago !== undefined) {
        if (!ESTADOS_PAGO_EDITABLES.includes(estadoPago)) {
          return res.status(400).json({ message: 'estadoPago debe ser pendiente o exento' });
        }
        if (!ESTADOS_PAGO_EDITABLES.includes(registro.estadoPago)) {
          return res.status(400).json({ message: 'Un check-in pagado no se puede cambiar de estado desde acá' });
        }
        registro.estadoPago = estadoPago;
      }

      registro.updatedBy = actor;
      await registro.save({ session });
      resultado = registro;
    });

    if (resultado) {
      logAudit({ clubId: req.user?.clubId, req, action: 'UPDATE', resource: 'Asistencia', resourceId: resultado._id, before: registroAntes, after: resultado.toObject() });
      return res.status(200).json(resultado);
    }
  } catch (error) {
    console.error('Error actualizando muro libre:', error);
    return res.status(500).json({ message: 'Error al actualizar registro' });
  } finally {
    session.endSession();
  }
};

export default updateMuroLibreHandler;
