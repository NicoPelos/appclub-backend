import mongoose from 'mongoose';

const escuelitaSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  socioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Socio',
    required: true,
    index: true,
  },
  dni: {
    type: String,
    default: '',
  },
  fechaInscripcion: {
    type: Date,
    default: Date.now,
  },
  planId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Plan',
    default: null,
    index: true,
  },
  observaciones: {
    type: String,
    default: '',
  },
  active: {
    type: Boolean,
    default: true,
    index: true,
  },
  createdBy: String,
  updatedBy: String,
}, { timestamps: true });

// Índice parcial (solo entre inscripciones activas) en vez de un unique
// simple sobre {clubId, socioId, active} — ese último incluía active:false
// en la restricción de unicidad, así que un socio con más de una baja
// terminaba con dos documentos {..., active:false} idénticos y la segunda
// baja rompía con E11000 (appcarc-backend#103). Los registros inactivos
// (historial de bajas) quedan fuera de la unicidad, que es lo que
// createAlumnoHandler ya asume al chequear duplicados solo con active:true.
escuelitaSchema.index(
  { clubId: 1, socioId: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

const Escuelita = mongoose.model('Escuelita', escuelitaSchema);

export default Escuelita;
