import mongoose from 'mongoose';

export const ESTADOS_ITEM = ['bueno', 'en_reparacion', 'baja'];

const fotoSchema = new mongoose.Schema({
  url: { type: String, required: true },
  createdBy: { type: String, default: '' },
}, { _id: true, timestamps: { createdAt: true, updatedAt: false } });

const itemInventarioSchema = new mongoose.Schema({
  clubId: { type: String, required: true, index: true },
  nombre: { type: String, required: true, trim: true },
  categoria: { type: String, default: '', trim: true },
  cantidad: { type: Number, default: 1, min: 0 },
  ubicacion: { type: String, default: '', trim: true },
  estado: { type: String, enum: ESTADOS_ITEM, default: 'bueno' },
  notas: { type: String, default: '' },
  fotos: { type: [fotoSchema], default: [] },
  active: { type: Boolean, default: true, index: true },
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

itemInventarioSchema.index({ clubId: 1, active: 1, nombre: 1 });

const ItemInventario = mongoose.model('ItemInventario', itemInventarioSchema);

export default ItemInventario;
