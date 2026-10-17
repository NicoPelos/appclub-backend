import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/demoSeed.service.js', () => ({
  resetDemoClub: vi.fn(),
}));
vi.mock('../../jobLock.service.js', () => ({
  acquireJobLock: vi.fn(),
  releaseJobLock: vi.fn().mockResolvedValue(),
}));

import { ejecutarResetDemo } from '../../resetDemo.job.js';
import { resetDemoClub } from '../../../services/demoSeed.service.js';
import { acquireJobLock, releaseJobLock } from '../../jobLock.service.js';

beforeEach(() => vi.clearAllMocks());

describe('ejecutarResetDemo', () => {
  it('resetea el club demo cuando obtiene el candado', async () => {
    acquireJobLock.mockResolvedValue(true);
    resetDemoClub.mockResolvedValue({ socios: 5 });

    await ejecutarResetDemo();

    expect(resetDemoClub).toHaveBeenCalledTimes(1);
    expect(releaseJobLock).toHaveBeenCalledWith('reset-demo');
  });

  it('no resetea si otra ejecución ya tiene el candado', async () => {
    acquireJobLock.mockResolvedValue(false);

    await ejecutarResetDemo();

    expect(resetDemoClub).not.toHaveBeenCalled();
    expect(releaseJobLock).not.toHaveBeenCalled();
  });

  it('libera el candado aunque resetDemoClub falle', async () => {
    acquireJobLock.mockResolvedValue(true);
    resetDemoClub.mockRejectedValue(new Error('boom'));

    await expect(ejecutarResetDemo()).resolves.not.toThrow();

    expect(releaseJobLock).toHaveBeenCalledWith('reset-demo');
  });
});
