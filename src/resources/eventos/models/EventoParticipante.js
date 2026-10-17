import mongoose from 'mongoose';

// Roster de un Evento (appcarc-backend#173) — un participante puede ser un
// socio real (`socioId` seteado) o alguien que no es socio (`socioId: null`,
// identificado solo por nombre/apellido) — mismo patrón que ya usa Asistencia
// para visitantes de Muro Libre no socios.
//
// Por qué es un modelo aparte y no reutiliza CargoPuntual: `CargoPuntual.socioId`
// (y `Cobro.items[].socioId`) son obligatorios — todo el pipeline de Cobro
// asume un socio real, es una asunción profunda en un flujo recién
// estabilizado (appcarc-backend#168). Este modelo imita el mismo vocabulario
// de estados y de `pagos[]`, pero sus pagos van directo a un Movimiento (que
// ya soporta `socioId: null`), sin pasar por Cobro — ver
// registrarPagoEventoParticipante.service.js (appcarc-backend#175).
export const ESTADOS_PARTICIPANTE = ['pendiente', 'parcial', 'pagada', 'anulada'];

const pagoParticipanteSchema = new mongoose.Schema({
  monto: { type: Number, required: true, min: 0 },
  fecha: { type: Date, required: true },
  // 'MercadoPago' habilitado junto con VALID_PAYMENT_METHODS en
  // registrarPagoEventoParticipante.service.js (autoservicio de pago de
  // eventos) — este enum es un segundo lugar separado que validaba lo
  // mismo y quedó desactualizado en el primer intento de ese cambio.
  paymentMethod: { type: String, enum: ['Efectivo', 'Transferencia', 'MercadoPago'], required: true },
  movimientoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movimiento', required: true },
  esPagoParcial: { type: Boolean, default: false },
}, { _id: true });

const eventoParticipanteSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  eventoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Evento',
    required: true,
    index: true,
  },
  // null = participante no-socio, identificado solo por nombre/apellido.
  socioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Socio',
    default: null,
    index: true,
  },
  // Snapshot de nombre/apellido al agregarlo (viene del Socio si es socio, o
  // se tipea a mano si no) — evita un populate extra solo para listar el
  // roster, y no se ve afectado si el socio edita su nombre después.
  nombre: { type: String, required: true },
  apellido: { type: String, default: '' },
  // Detalle libre (talle, modelo, etc.) — para casos como venta de remeras
  // donde el monto no dice por sí solo qué compuso el pedido.
  notas: { type: String, default: '' },
  montoEsperadoSnapshot: { type: Number, required: true, min: 0 },
  montoPagadoSnapshot: { type: Number, default: 0, min: 0 },
  estado: {
    type: String,
    enum: ESTADOS_PARTICIPANTE,
    default: 'pendiente',
    index: true,
  },
  pagos: {
    type: [pagoParticipanteSchema],
    default: [],
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

// Un mismo socio no puede estar dos veces en el roster de un mismo evento —
// solo aplica a participantes-socio activos (partialFilterExpression), para
// no bloquear reagregar a alguien después de sacarlo por error (soft delete)
// y para no chocar entre sí los muchos participantes con socioId: null.
eventoParticipanteSchema.index(
  { eventoId: 1, socioId: 1 },
  { unique: true, partialFilterExpression: { socioId: { $type: 'objectId' }, active: true } },
);
eventoParticipanteSchema.index({ clubId: 1, socioId: 1, estado: 1, active: 1 });

const EventoParticipante = mongoose.model('EventoParticipante', eventoParticipanteSchema);

export default EventoParticipante;
