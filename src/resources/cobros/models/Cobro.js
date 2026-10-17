import mongoose from 'mongoose';

const cobroItemSchema = new mongoose.Schema({
  socioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Socio',
    required: true,
  },
  suscripcionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Suscripcion',
    default: null,
  },
  cargoPuntualId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CargoPuntual',
    default: null,
  },
  asistenciaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Asistencia',
    default: null,
  },
  etiquetaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Etiqueta',
    required: true,
  },
  periodo: {
    type: String,
    required: true,
    match: /^\d{4}-(0[1-9]|1[0-2])$/,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  precioSugeridoSnapshot: {
    type: Number,
    default: null,
  },
  precioCodigo: {
    type: String,
    default: '',
  },
  description: {
    type: String,
    default: '',
  },
  // Solo tiene sentido para items con cargoPuntualId — si ese pago fue "a
  // cuenta" (queda saldo pendiente) o cerró el cargo (appcarc-backend#168).
  // Antes se usaba solo en memoria al registrar el cobro y se perdía: el
  // Cobro no quedaba autocontenido (había que cruzar por CargoPuntual.pagos[]
  // para saber si fue una seña), y "cambiar forma de pago" no podía
  // replayar un cargo puntual sin arriesgarse a perder esa distinción.
  esPagoParcial: {
    type: Boolean,
    default: false,
  },
}, { _id: false });

const cobroSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  responsable: {
    type: String,
    required: true,
  },
  paymentMethod: {
    type: String,
    enum: ['Efectivo', 'Transferencia', 'MercadoPago'],
    required: true,
  },
  totalAmount: {
    type: Number,
    required: true,
    min: 0,
  },
  description: {
    type: String,
    default: '',
  },
  date: {
    type: Date,
    default: Date.now,
  },
  items: {
    type: [cobroItemSchema],
    validate: {
      validator: (items) => Array.isArray(items) && items.length > 0,
      message: 'El cobro debe tener al menos un item',
    },
  },
  movimientoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Movimiento',
    default: null,
  },
  createdBy: {
    type: String,
    required: true,
  },
  updatedBy: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  anuladoAt: {
    type: Date,
    default: null,
  },
  anuladoPor: {
    type: String,
    default: null,
  },
  motivoAnulacion: {
    type: String,
    default: null,
  },
  // Con qué precio se valuaron los items de suscripción (appcarc-backend#285):
  // 'actual' (el de hoy, el de siempre) o 'historico' (el que regía cada mes,
  // con permiso cobros:precio-historico). En modo histórico cada item guarda
  // ese precio en `amount` y el de hoy en `precioSugeridoSnapshot`, así queda
  // la diferencia que el club decidió no cobrar. Quién lo hizo: createdBy.
  modoPrecio: {
    type: String,
    enum: ['actual', 'historico'],
    default: 'actual',
  },
  motivoPrecioHistorico: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

export default mongoose.model('Cobro', cobroSchema);
