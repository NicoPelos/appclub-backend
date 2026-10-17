import mongoose from 'mongoose';

const horariosSchema = new mongoose.Schema({
  clubId:       { type: String, index: true },
  socioId:      { type: mongoose.Schema.Types.ObjectId, ref: 'Socio', default: null, index: true },
  fecha:        Date,
  observaciones: String,
  horaEntrada:  Date,
  horaSalida:   Date,
  etiquetaId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Etiqueta', default: null, index: true },
  totalHoras:   Number,
  idHorarios:   { type: String, unique: true },
  createdBy:    String,
  updatedBy:    String,
  active:       { type: Boolean, default: true, index: true },
  deletedAt:    { type: Date, default: null },
  deletedBy:    { type: String, default: null },
}, { timestamps: true });

const Horarios = mongoose.model('Horarios', horariosSchema);

export default Horarios;
