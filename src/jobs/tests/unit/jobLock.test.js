import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/JobLock.js', () => ({
  default: { findOneAndUpdate: vi.fn(), deleteOne: vi.fn() },
}));

import { acquireJobLock, releaseJobLock } from '../../jobLock.service.js';
import JobLock from '../../models/JobLock.js';

beforeEach(() => vi.clearAllMocks());

describe('acquireJobLock', () => {
  it('devuelve true cuando no había candado o estaba vencido', async () => {
    JobLock.findOneAndUpdate.mockResolvedValue({ _id: 'x', lockedAt: new Date() });

    const result = await acquireJobLock('x');

    expect(result).toBe(true);
    expect(JobLock.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: 'x' }),
      expect.objectContaining({ $set: expect.objectContaining({ lockedAt: expect.any(Date) }) }),
      { upsert: true },
    );
  });

  it('devuelve false cuando otra ejecución ya tiene el candado (duplicate key)', async () => {
    const dupError = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
    JobLock.findOneAndUpdate.mockRejectedValue(dupError);

    const result = await acquireJobLock('x');

    expect(result).toBe(false);
  });

  it('propaga cualquier otro error que no sea de clave duplicada', async () => {
    JobLock.findOneAndUpdate.mockRejectedValue(new Error('DB caída'));

    await expect(acquireJobLock('x')).rejects.toThrow('DB caída');
  });
});

describe('releaseJobLock', () => {
  it('borra el documento del candado', async () => {
    JobLock.deleteOne.mockResolvedValue({});

    await releaseJobLock('x');

    expect(JobLock.deleteOne).toHaveBeenCalledWith({ _id: 'x' });
  });
});
