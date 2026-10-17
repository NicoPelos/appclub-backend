import mongoose from 'mongoose';

export const CATEGORIAS_POR_DEFECTO = [
  'Cuerdas',
  'Cascos',
  'Arneses',
  'Anclajes',
  'Herramientas',
  'Campamento',
  'Cocina',
  'Otros',
];

const categoriaInventarioSchema = new mongoose.Schema({
  clubId: { type: String, required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  active: { type: Boolean, default: true },
  createdBy: { type: String, default: '' },
}, { timestamps: true });

categoriaInventarioSchema.index({ clubId: 1, nombre: 1 }, { unique: true, collation: { locale: 'es', strength: 2 } });

const CategoriaInventario = mongoose.model('CategoriaInventario', categoriaInventarioSchema);

export default CategoriaInventario;
