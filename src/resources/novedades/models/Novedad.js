import mongoose from 'mongoose';

const novedadSchema = new mongoose.Schema({
  clubId: { type: String, required: true, index: true },
  titulo: { type: String, required: true },
  cuerpo: { type: String, default: '' },
  imagenUrl: { type: String, default: null },
  linkOriginal: { type: String, default: null },
  fuente: { type: String, enum: ['instagram', 'manual', 'rss'], required: true, index: true },
  fuenteId: { type: String, default: undefined }, // GUID del item RSS — evita duplicados
  categoria: { type: String, default: '' },
  fechaPublicacion: { type: Date, default: Date.now, index: true },
  createdBy: { type: String, default: '' },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Evita importar el mismo post de Instagram dos veces. partialFilterExpression
// (no sparse): un sparse index compuesto solo excluye un documento si TODOS
// sus campos indexados están ausentes, y clubId siempre está presente — así
// que "sparse" nunca protegía a las novedades manuales (fuenteId ausente).
novedadSchema.index(
  { clubId: 1, fuenteId: 1 },
  { unique: true, partialFilterExpression: { fuenteId: { $type: 'string' } } },
);

const Novedad = mongoose.model('Novedad', novedadSchema);

export default Novedad;
