// Quién hizo una acción, para createdBy/updatedBy/deletedBy/actor en
// auditoría y trazabilidad (appcarc-backend#263) — antes esto se repetía
// a mano en 79 lugares, en 4 variantes inconsistentes (`||` vs `??`, con y
// sin optional chaining, con y sin fallback 'Sistema'). `protect` siempre
// deja `req.user` con `email`/`id` reales en una request autenticada, así
// que en la práctica las 4 variantes ya resolvían al mismo valor — acá
// queda la más completa y defensiva de las cuatro, aplicada en todos lados.
export const getActor = (req) => req.user?.email ?? req.user?.id ?? 'Sistema';

export default getActor;
