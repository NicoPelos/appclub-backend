import mongoose from 'mongoose';

// Igual que JuegoPuntaje (mejor puntaje, no historial de partidas), pero
// acotado a una semana: una fila por (clubId, userId, semana). `semana` es
// la clave que arma semanaKeyArgentina (el lunes de esa semana, YYYY-MM-DD)
// — al llegar una semana nueva, simplemente no hay filas todavía con esa
// clave, así que el podio semanal "arranca vacío" solo, sin ningún cron ni
// reset explícito. Las semanas viejas quedan en la colección (no se borran),
// por si en algún momento se quiere mostrar "la semana pasada".
const juegoPuntajeSemanalSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
    type: String,
    required: true,
  },
  semana: {
    type: String,
    required: true,
  },
  socioId: {
    type: String,
    default: null,
  },
  nombre: {
    type: String,
    required: true,
  },
  apellido: {
    type: String,
    default: '',
  },
  score: {
    type: Number,
    required: true,
    min: 0,
  },
}, { timestamps: true });

juegoPuntajeSemanalSchema.index({ clubId: 1, userId: 1, semana: 1 }, { unique: true });
juegoPuntajeSemanalSchema.index({ clubId: 1, semana: 1, score: -1 });

const JuegoPuntajeSemanal = mongoose.model('JuegoPuntajeSemanal', juegoPuntajeSemanalSchema);

export default JuegoPuntajeSemanal;
