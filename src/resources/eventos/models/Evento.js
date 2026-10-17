import mongoose from 'mongoose';

// Categorías propias del Evento — independientes de CATEGORIAS_MOVIMIENTO.Ingreso
// (que sirve para "Registrar Movimiento" manual, un caso de uso distinto: no
// todas tienen sentido en ambos lados, ej. "Charla / Curso" no es una forma
// de categorizar un ingreso manual, y "Subsidios / Donaciones" no es un tipo
// de evento). El "Ingresos por categoría" del Dashboard agrupa por lo que
// haya en `Movimiento.categoria` sin una lista fija, así que copiar
// `evento.categoria` ahí (registrarPagoEventoParticipante.service.js,
// appcarc-backend#175) sigue funcionando aunque las listas difieran.
export const CATEGORIAS_EVENTO = ['Viajes', 'Charla / Curso', 'Ventas / Reventa', 'Otros'];

export const ESTADOS_EVENTO = ['abierto', 'cerrado'];

const eventoSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  nombre: {
    type: String,
    required: true,
  },
  descripcion: {
    type: String,
    default: '',
  },
  categoria: {
    type: String,
    enum: CATEGORIAS_EVENTO,
    required: true,
  },
  fecha: {
    type: Date,
    required: true,
  },
  // Sugerencia al agregar un participante (appcarc-backend#174) — cada
  // participante puede editarlo igual que ya pasa con CargoPuntual, no es
  // un precio fijo para todos.
  precioSugerido: {
    type: Number,
    default: null,
    min: 0,
  },
  estado: {
    type: String,
    enum: ESTADOS_EVENTO,
    default: 'abierto',
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: String, default: null },
  createdBy: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
}, { timestamps: true });

eventoSchema.index({ clubId: 1, active: 1, fecha: -1 });

const Evento = mongoose.model('Evento', eventoSchema);

export default Evento;
