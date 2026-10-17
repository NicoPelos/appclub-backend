import User from '../../usuarios/models/User.js';
import VinculoFamiliar from '../models/VinculoFamiliar.js';

// Mismos perfiles que ofrece "cambiar de perfil" (ver obtenerPerfilesDisponibles
// en usuarios/handlers/auth.handler.js): el propio socio del usuario (si es
// socio) más los hijos vinculados activos. Se usa para autorizar acciones que
// un tutor puede hacer sobre varios de sus perfiles a la vez sin necesidad de
// cambiar cuál está "activo" en la sesión (por ejemplo, pagar la cuota propia
// y la de un hijo en un mismo link de Mercado Pago).
export const getSocioIdsAccesibles = async ({ clubId, userId }) => {
  const [user, vinculos] = await Promise.all([
    User.findById(userId).select('socioId').lean(),
    VinculoFamiliar.find({ clubId, padreUserId: userId, active: true }).select('hijoSocioId').lean(),
  ]);

  const accessibleIds = new Set();
  const ownSocioId = user?.socioId ? String(user.socioId) : null;
  if (ownSocioId) accessibleIds.add(ownSocioId);
  for (const v of vinculos) accessibleIds.add(String(v.hijoSocioId));

  return { ownSocioId, accessibleIds };
};

export default getSocioIdsAccesibles;
