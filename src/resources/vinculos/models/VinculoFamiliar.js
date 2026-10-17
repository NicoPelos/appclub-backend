import mongoose from 'mongoose';

const vinculoFamiliarSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  padreUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  hijoSocioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Socio',
    required: true,
    index: true,
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

// partialFilterExpression en vez de meter `active` en la clave del índice
// (appcarc-backend#211): con `active` en la clave, la unicidad también se
// exigía entre documentos inactivos — el segundo ciclo de
// vincular/anular/re-vincular/anular entre el mismo par tutor-hijo chocaba
// con el primer doc ya anulado (E11000 -> 500). Mismo patrón ya corregido en
// Escuelita.js, Etiqueta.js, Cuota.js, Rol.js y Plan.js.
vinculoFamiliarSchema.index(
  { clubId: 1, padreUserId: 1, hijoSocioId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

export default mongoose.model('VinculoFamiliar', vinculoFamiliarSchema);
