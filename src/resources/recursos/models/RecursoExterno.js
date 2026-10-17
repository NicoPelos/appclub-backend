import mongoose from 'mongoose';

// Links curados a sitios de terceros (theCrag, Wikiloc, etc.) que cada club va
// armando con el tiempo — topos de escalada y senderos de trekking mostrados
// en la app (ver ExternalCragList en appCARC-mobile). No hay dato propio del
// club detrás de cada link, solo la curaduría de qué mostrar y en qué orden
// (appCARC-mobile#16).
const recursoExternoSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  tipo: {
    type: String,
    enum: ['topo', 'sendero'],
    required: true,
  },
  provincia: {
    type: String,
    required: true,
  },
  nombre: {
    type: String,
    required: true,
  },
  descripcion: {
    type: String,
    default: '',
  },
  url: {
    type: String,
    required: true,
  },
  // Link opcional de "ver todas las zonas/rutas de esta provincia" en el
  // sitio de origen — no todos los recursos lo necesitan, alcanza con que
  // uno de la misma provincia lo tenga para que la app lo muestre.
  urlProvincia: {
    type: String,
    default: null,
  },
  orden: {
    type: Number,
    default: 0,
  },
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

recursoExternoSchema.index({ clubId: 1, tipo: 1, active: 1 });

const RecursoExterno = mongoose.model('RecursoExterno', recursoExternoSchema);

export default RecursoExterno;
