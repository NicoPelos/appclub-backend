import mongoose from 'mongoose';

const cuotaSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  socioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Socio',
    required: true,
    index: true,
  },
  suscripcionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Suscripcion',
    index: true,
  },
  etiquetaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Etiqueta',
    default: null,
    index: true,
  },
  periodo: {
    type: String,
    required: true,
    match: /^\d{4}-(0[1-9]|1[0-2])$/,
    index: true,
  },
  estado: {
    type: String,
    enum: ['pendiente', 'pagada', 'anulada'],
    default: 'pendiente',
    index: true,
  },
  montoEsperadoSnapshot: {
    type: Number,
    required: true,
    min: 0,
  },
  montoPagadoSnapshot: {
    type: Number,
    default: 0,
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
  cobroId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cobro',
    default: null,
  },
  movimientoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Movimiento',
    default: null,
  },
  fechaPago: {
    type: Date,
    default: null,
  },
  paymentMethod: {
    type: String,
    enum: ['Efectivo', 'Transferencia', 'MercadoPago'],
    required: true,
  },
  description: {
    type: String,
    default: '',
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
}, {
  timestamps: true,
});

// Índice parcial (solo cuando suscripcionId es un ObjectId real) en vez de
// sparse — sparse solo excluye un documento si TODOS los campos indexados
// están ausentes, y acá clubId/socioId/periodo son required y active tiene
// default, así que el documento nunca quedaba realmente exento (appcarc-backend#99).
// Además, suscripcionId ya no tiene default:null en el schema (un null
// explícito cuenta como "presente" para Mongo, rompía la intención de sparse
// igual que el índice compuesto).
cuotaSchema.index(
  { clubId: 1, socioId: 1, suscripcionId: 1, periodo: 1, active: 1 },
  { unique: true, partialFilterExpression: { suscripcionId: { $type: 'objectId' } } },
);

export default mongoose.model('Cuota', cuotaSchema);
