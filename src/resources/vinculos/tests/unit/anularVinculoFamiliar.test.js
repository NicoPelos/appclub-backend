import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { anularVinculoFamiliar } from '../../services/anularVinculoFamiliar.service.js';
import { BusinessError } from '../../services/businessError.js';
import VinculoFamiliar from '../../models/VinculoFamiliar.js';

const CLUB_ID = 'club1';
const VINCULO_ID = '507f1f77bcf86cd799439077';
const USER = { id: '507f1f77bcf86cd799439012', email: 'secretaria@carc.test' };

const buildVinculo = (overrides = {}) => ({
  _id: VINCULO_ID,
  active: true,
  updatedBy: '',
  save: vi.fn(async function () { return this; }),
  ...overrides,
});

describe('anularVinculoFamiliar service (unit)', () => {
  beforeEach(() => {
    VinculoFamiliar.findOne = vi.fn();
  });

  afterEach(() => vi.restoreAllMocks());

  it('should fail with 404 when vínculo not found', async () => {
    VinculoFamiliar.findOne.mockResolvedValue(null);

    await expect(anularVinculoFamiliar({ clubId: CLUB_ID, user: USER, id: VINCULO_ID }))
      .rejects.toBeInstanceOf(BusinessError);
    await expect(anularVinculoFamiliar({ clubId: CLUB_ID, user: USER, id: VINCULO_ID }))
      .rejects.toMatchObject({ status: 404 });
  });

  it('should anular an active vínculo', async () => {
    const vinculo = buildVinculo();
    VinculoFamiliar.findOne.mockResolvedValue(vinculo);

    const result = await anularVinculoFamiliar({ clubId: CLUB_ID, user: USER, id: VINCULO_ID });

    expect(vinculo.active).toBe(false);
    expect(vinculo.updatedBy).toBe(USER.email);
    expect(vinculo.save).toHaveBeenCalledTimes(1);
    expect(result).toBe(vinculo);
  });
});
