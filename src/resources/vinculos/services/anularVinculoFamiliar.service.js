import VinculoFamiliar from '../models/VinculoFamiliar.js';

import { BusinessError } from './businessError.js';

export const anularVinculoFamiliar = async ({ clubId, user, id }) => {
  const vinculo = await VinculoFamiliar.findOne({ _id: id, clubId, active: true });
  if (!vinculo) throw new BusinessError('Vínculo no encontrado', 404);

  const actor = user?.email || user?.id;
  vinculo.active = false;
  vinculo.updatedBy = actor;
  await vinculo.save();

  return vinculo;
};

