import Cuota from '../../cuotas/models/Cuota.js';
import CargoPuntual from '../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../asistencias/models/Asistencia.js';

// Anula un Cobro y revierte TODO lo que registrarCobro.service.js pudo haber
// marcado como pagado con él: Cuota, CargoPuntual y Asistencia (muro libre) —
// las tres entidades que un mismo Cobro puede saldar según el tipo de item
// (ver registrarCobro.service.js:397-422). Compartido entre anularCobro.handler.js
// (POST /cobros/:id/anular) y deleteMovimiento.handler.js (borrar el
// movimiento asociado) — antes cada uno tenía su propia copia parcial de esta
// lógica y quedaron desincronizadas: deleteMovimiento nunca llegó a revertir
// CargoPuntual ni Asistencia, dejándolos pagados para siempre sin respaldo
// (appcarc-backend#137).
export const anularCobroConTrazabilidad = async ({ cobro, clubId, actor, motivo, session }) => {
  cobro.active = false;
  cobro.anuladoAt = new Date();
  cobro.anuladoPor = actor;
  cobro.motivoAnulacion = motivo || null;
  cobro.updatedBy = actor;
  await cobro.save({ session });

  await Cuota.updateMany(
    { cobroId: cobro._id, clubId },
    { estado: 'anulada', updatedBy: actor },
    { session },
  );

  // Un CargoPuntual puede tener más de un pago real contra él (seña + saldo,
  // appcarc-backend#168) — hay que revertir SOLO el pago que corresponde a
  // este Cobro (buscando dentro de `pagos`, no por el campo `cobroId` de
  // primer nivel, que solo refleja el ÚLTIMO pago) y recalcular el estado
  // según lo que quede, en vez de resetear el cargo entero a 'pendiente'.
  const cargosAfectados = await CargoPuntual.find({ clubId, 'pagos.cobroId': cobro._id, active: true }).session(session);
  for (const cargo of cargosAfectados) {
    cargo.pagos = cargo.pagos.filter((p) => String(p.cobroId) !== String(cobro._id));
    cargo.montoPagadoSnapshot = cargo.pagos.reduce((sum, p) => sum + p.monto, 0);

    if (cargo.pagos.length === 0) {
      cargo.estado = 'pendiente';
      cargo.paymentMethod = null;
      cargo.fechaPago = null;
      cargo.cobroId = null;
      cargo.movimientoId = null;
    } else {
      cargo.estado = cargo.montoPagadoSnapshot >= cargo.montoEsperadoSnapshot ? 'pagada' : 'parcial';
      const ultimoPago = cargo.pagos[cargo.pagos.length - 1];
      cargo.paymentMethod = ultimoPago.paymentMethod;
      cargo.fechaPago = ultimoPago.fecha;
      cargo.cobroId = ultimoPago.cobroId;
      cargo.movimientoId = ultimoPago.movimientoId;
    }
    cargo.updatedBy = actor;
    await cargo.save({ session });
  }

  await Asistencia.updateMany(
    { cobroId: cobro._id, clubId },
    {
      estadoPago: 'pendiente',
      monto: 0,
      formaPago: 'Sin pago',
      cobroId: null,
      movimientoId: null,
      updatedBy: actor,
    },
    { session },
  );
};

export default anularCobroConTrazabilidad;
