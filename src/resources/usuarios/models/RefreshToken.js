import mongoose from 'mongoose';

// Refresh token real (appcarc-mobile#107) — el access token pasó de 8h a
// una vida corta; esto es lo que permite renovarlo en silencio sin pedir
// contraseña de nuevo, mientras haya actividad real.
const refreshTokenSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Se guarda un hash (sha256), nunca el token en texto plano — igual
  // criterio que una contraseña: si se filtra la base, no se puede usar.
  tokenHash: { type: String, required: true, unique: true },
  // Mismo payload con el que se firmó el access token vigente al emitir este
  // refresh token, para poder reemitir sin perder el perfil activo — un
  // usuario "entrando como" un hijo vinculado no debe volver a su propio
  // perfil solo porque el access token expiró en el medio.
  payload: {
    email: String,
    roles: { type: [String], default: [] },
    clubId: String,
    socioId: { type: String, default: null },
  },
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

// TTL index: Mongo borra el documento solo al llegar expiresAt, sin cron aparte.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

export default RefreshToken;
