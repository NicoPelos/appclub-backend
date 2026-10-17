import mongoose from 'mongoose';

// Advertencias de estado (no ligadas a un check-in puntual, como las que se
// guardan embebidas en Asistencia). Se abren y se mantienen actualizadas por
// jobs periódicos (ver avisoMorosidad.job.js) mientras la condición siga
// vigente, y se resuelven solas cuando deja de aplicar.
const advertenciaSchema = new mongoose.Schema({
  clubId: { type: String, required: true, index: true },
  socioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Socio', required: true, index: true },
  codigo: { type: String, required: true },
  mensaje: { type: String, required: true },
  nombre: { type: String, required: true },
  apellido: { type: String, default: '' },
  estado: { type: String, enum: ['abierta', 'resuelta'], default: 'abierta', index: true },
  detectadoEn: { type: Date, required: true },
  ultimaRevision: { type: Date, required: true },
  resueltoEn: { type: Date, default: null },
}, { timestamps: true });

advertenciaSchema.index(
  { clubId: 1, socioId: 1, codigo: 1, estado: 1 },
  { unique: true, partialFilterExpression: { estado: 'abierta' } },
);

const Advertencia = mongoose.model('Advertencia', advertenciaSchema);

export default Advertencia;
