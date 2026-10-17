import mongoose from 'mongoose';

// plan_deuda: planes de pago para deuda acumulada (ej. cuota social vieja
// impaga) — conviven con la suscripción normal del socio a otras etiquetas,
// son una categoría aparte para no mezclarlos con la oferta regular del club.
export const TIPOS = ['social', 'escuelita', 'muro_libre', 'plan_deuda'];
export const MODALIDADES = ['mensual', 'por_uso'];

const planSchema = new mongoose.Schema({
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
  tipo: {
    type: String,
    enum: TIPOS,
    required: true,
    index: true,
  },
  modalidad: {
    type: String,
    enum: MODALIDADES,
    required: true,
    index: true,
  },
  etiquetaId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Etiqueta',
    required: true,
    index: true,
  },
  atributos: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  noGeneraDeuda: {
    type: Boolean,
    default: false,
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

// partialFilterExpression: un plan con soft-delete (active:false) no debe
// bloquear reusar su nombre — mismo criterio que Rol.js:15-16 (appcarc-backend#125).
planSchema.index({ clubId: 1, nombre: 1 }, { unique: true, partialFilterExpression: { active: true } });
planSchema.index({ clubId: 1, tipo: 1, active: 1 });

const Plan = mongoose.model('Plan', planSchema);

export default Plan;
