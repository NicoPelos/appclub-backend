import mongoose from 'mongoose';

const etiquetaSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  nombre: {
    type: String,
    required: true,
  },
  unidad: {
    type: String,
    enum: ['mes', 'hora', 'dia', 'pase', 'unico'],
    required: true,
  },
  uso_sistema: {
    type: String,
    default: null,
  },
  // Pases de muro libre que incluye la etiqueta por semana (lunes a domingo).
  // Solo aplica a planes de adultos; los de niños quedan en 0.
  pasesMuroPorSemana: { type: Number, default: 0, min: 0 },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

// partialFilterExpression (no sparse): "sparse" solo excluye el campo cuando
// está AUSENTE, pero acá uso_sistema siempre está presente con default: null,
// así que un índice sparse indexaría igual todos los null y el unique
// rechazaría clubes con más de una etiqueta sin uso_sistema configurado.
// También excluye inactivas (soft-deleted) — sin esto, borrar una etiqueta
// con uso_sistema y volver a crear una con el mismo uso_sistema fallaba con
// E11000 aunque el chequeo de aplicación (que sí filtra active:true) no viera
// ningún conflicto — mismo patrón ya arreglado en Escuelita/Cuota (f57ab3c).
etiquetaSchema.index(
  { clubId: 1, uso_sistema: 1 },
  { unique: true, partialFilterExpression: { uso_sistema: { $type: 'string' }, active: true } },
);

const Etiqueta = mongoose.model('Etiqueta', etiquetaSchema);

export default Etiqueta;
