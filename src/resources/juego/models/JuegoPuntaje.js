import mongoose from 'mongoose';

// Mejor puntaje de cada usuario en el mini-juego "Escalada Infinita" — una
// fila por (clubId, userId), no un historial de partidas: solo interesa el
// podio de mejores puntajes, no cada intento. nombre/apellido quedan
// guardados acá (snapshot al momento de jugar, no un populate a Socio/User)
// para que el podio se lea con una sola query, sin joins — un juego, no un
// dato de negocio que necesite reflejar cambios de nombre retroactivos.
const juegoPuntajeSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
    index: true,
  },
  userId: {
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

juegoPuntajeSchema.index({ clubId: 1, userId: 1 }, { unique: true });
juegoPuntajeSchema.index({ clubId: 1, score: -1 });

const JuegoPuntaje = mongoose.model('JuegoPuntaje', juegoPuntajeSchema);

export default JuegoPuntaje;
