import mongoose from 'mongoose';

const preciosSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  // Nueva arquitectura: precio pertenece a una Etiqueta (concepto de precio)
  etiquetaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Etiqueta',
    default: null,
    index: true,
  },
  unidad: {
    type: String,
    enum: ['mes', 'hora', 'dia', 'pase', 'unico'],
    required: true,
  },
  monto: {
    type: Number,
    required: true,
    min: 0,
  },
  moneda: {
    type: String,
    default: 'ARS',
  },
  vigenteDesde: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
  },
  vigenteHasta: {
    type: Date,
    default: null,
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  // Último aviso de vencimiento sin reemplazo que mandó alertaPrecios.job
  // (appcarc-backend#317): para cuál vigenteHasta y en qué escalón (30, 14,
  // 7 o 1 días antes). Lo escribe solo el job, no los endpoints; si cambia
  // vigenteHasta, los avisos arrancan de nuevo.
  avisoVencimiento: {
    type: new mongoose.Schema({
      vigenteHasta: { type: Date, required: true },
      diasAntes: { type: Number, required: true },
    }, { _id: false }),
    default: null,
  },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

preciosSchema.index({ clubId: 1, etiquetaId: 1, vigenteDesde: -1 });

const Precios = mongoose.model('Precios', preciosSchema);

export default Precios;
