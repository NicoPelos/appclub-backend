import crypto from 'crypto';
import RefreshToken from '../resources/usuarios/models/RefreshToken.js';

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

const hashToken = (raw) => crypto.createHash('sha256').update(raw).digest('hex');

/** Emite un refresh token opaco nuevo para `userId`, con el payload
 * (roles/clubId/socioId) del access token recién generado, para que una
 * futura renovación reproduzca el mismo perfil activo. Devuelve el token en
 * texto plano — solo existe una vez, no se puede recuperar después. */
export async function issueRefreshToken(userId, payload) {
  const raw = crypto.randomBytes(48).toString('hex');
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(raw),
    payload,
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  return raw;
}

/** Consume un refresh token vigente en un solo paso: quien lo borra primero
 * es el único que se lleva la sesión (appcarc-backend#248). */
export async function claimRefreshToken(raw) {
  if (!raw) return null;
  return RefreshToken.findOneAndDelete({ tokenHash: hashToken(raw), expiresAt: { $gt: new Date() } });
}

/** Revoca (borra) un refresh token puntual — usado al hacer logout explícito. */
export async function revokeRefreshToken(raw) {
  if (!raw) return;
  await RefreshToken.deleteOne({ tokenHash: hashToken(raw) });
}

export default { issueRefreshToken, claimRefreshToken, revokeRefreshToken };
