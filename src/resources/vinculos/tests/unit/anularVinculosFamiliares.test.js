import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/VinculoFamiliar.js', () => ({
  default: { updateMany: vi.fn().mockResolvedValue({}) },
}));

import VinculoFamiliar from '../../models/VinculoFamiliar.js';
import { anularVinculosFamiliares } from '../../services/anularVinculosFamiliares.service.js';

describe('anularVinculosFamiliares (appcarc-backend#253)', () => {
  beforeEach(() => {
    VinculoFamiliar.updateMany.mockClear();
  });

  it('anula los vínculos del hijo borrado', async () => {
    await anularVinculosFamiliares({ clubId: 'CARC', hijoSocioIds: ['s1'], actor: 'staff@x.com' });
    expect(VinculoFamiliar.updateMany).toHaveBeenCalledWith(
      { clubId: 'CARC', active: true, $or: [{ hijoSocioId: { $in: ['s1'] } }] },
      { $set: { active: false, updatedBy: 'staff@x.com' } },
    );
  });

  it('anula los vínculos de un tutor desactivado', async () => {
    await anularVinculosFamiliares({ clubId: 'CARC', padreUserIds: ['u1'], actor: 'super@x.com' });
    expect(VinculoFamiliar.updateMany).toHaveBeenCalledWith(
      { clubId: 'CARC', active: true, $or: [{ padreUserId: { $in: ['u1'] } }] },
      { $set: { active: false, updatedBy: 'super@x.com' } },
    );
  });

  it('no toca nada si no hay ids', async () => {
    await anularVinculosFamiliares({ clubId: 'CARC', actor: 'x' });
    expect(VinculoFamiliar.updateMany).not.toHaveBeenCalled();
  });
});
