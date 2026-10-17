import mongoose from 'mongoose';

const cargoPuntualSchema = new mongoose.Schema({
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
  etiquetaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Etiqueta',
    required: true,
    index: true,
  },
  periodo: {
    type: String,
    required: true,
    match: /^\d{4}-(0[1-9]|1[0-2])$/,
  },
  description: {
    type: String,
    required: true,
  },
  // 'parcial': se cobró una parte (seña) y queda un saldo real pendiente —
  // distinto de "ajustar el monto" (cobrar de más o de menos del sugerido
  // pero dar el cargo por saldado), que sigue yendo directo a 'pagada' como
  // siempre. La diferencia entre ambos casos la decide quien cobra, nunca
  // se infiere comparando montos (ver appcarc-backend#168).
  estado: {
    type: String,
    enum: ['pendiente', 'parcial', 'pagada', 'anulada'],
    default: 'pendiente',
    index: true,
  },
  montoEsperadoSnapshot: {
    type: Number,
    required: true,
    min: 0,
  },
  // Suma de todos los pagos reales hechos contra este cargo (ver `pagos`
  // más abajo) — derivado, se recalcula en cada pago o reversión.
  montoPagadoSnapshot: {
    type: Number,
    default: 0,
    min: 0,
  },
  precioSugeridoSnapshot: {
    type: Number,
    default: null,
  },
  // Un cargo puede pagarse en más de un evento real (seña + saldo), cada uno
  // con su propio Cobro/Movimiento — necesario para poder revertir
  // exactamente el pago que corresponde si se anula uno de esos cobros, sin
  // afectar los demás (appcarc-backend#168).
  pagos: {
    type: [{
      monto: { type: Number, required: true, min: 0 },
      fecha: { type: Date, required: true },
      paymentMethod: { type: String, enum: ['Efectivo', 'Transferencia', 'MercadoPago'], required: true },
      cobroId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cobro', required: true },
      movimientoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movimiento', required: true },
      esPagoParcial: { type: Boolean, default: false },
    }],
    default: [],
  },
  // Espejo del ÚLTIMO pago (o el único, en el caso común de un cargo pagado
  // de una vez) — `pagos` de arriba es la fuente real cuando hay más de uno.
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
}, {
  timestamps: true,
});

cargoPuntualSchema.index({ clubId: 1, socioId: 1, estado: 1, active: 1 });

export default mongoose.model('CargoPuntual', cargoPuntualSchema);
