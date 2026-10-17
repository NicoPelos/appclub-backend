import VinculoFamiliar from '../models/VinculoFamiliar.js';

// Un vínculo activo da acceso a los datos de un menor: si el hijo se borra o el
// tutor se desactiva, el vínculo tiene que caer con ellos (appcarc-backend#253).
export const anularVinculosFamiliares = async ({ clubId, hijoSocioIds = [], padreUserIds = [], actor }) => {
  const condiciones = [];
  if (hijoSocioIds.length) condiciones.push({ hijoSocioId: { $in: hijoSocioIds } });
  if (padreUserIds.length) condiciones.push({ padreUserId: { $in: padreUserIds } });
  if (!condiciones.length) return;

  await VinculoFamiliar.updateMany(
    { clubId, active: true, $or: condiciones },
    { $set: { active: false, updatedBy: actor } },
  );
};

export default anularVinculosFamiliares;
