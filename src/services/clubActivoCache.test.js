import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../resources/clubs/models/Club.js', () => ({
  default: { findOne: vi.fn() },
}));

import Club from '../resources/clubs/models/Club.js';
import { esClubActivo, invalidarClubActivo } from './clubActivoCache.js';

const mockLean = (value) => ({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }) });

describe('clubActivoCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidarClubActivo('CARC');
    invalidarClubActivo('SIN_CLUB');
  });

  it('devuelve true sin consultar la base cuando no hay slug', async () => {
    expect(await esClubActivo(null)).toBe(true);
    expect(Club.findOne).not.toHaveBeenCalled();
  });

  it('devuelve true si el club existe y está activo', async () => {
    Club.findOne.mockReturnValue(mockLean({ active: true }));
    expect(await esClubActivo('CARC')).toBe(true);
  });

  it('devuelve false si el club existe y está suspendido', async () => {
    Club.findOne.mockReturnValue(mockLean({ active: false }));
    expect(await esClubActivo('CARC')).toBe(false);
  });

  it('devuelve true si no existe un Club para ese slug (no bloquea por datos legacy)', async () => {
    Club.findOne.mockReturnValue(mockLean(null));
    expect(await esClubActivo('SIN_CLUB')).toBe(true);
  });

  it('cachea el resultado — una segunda consulta no vuelve a golpear la base', async () => {
    Club.findOne.mockReturnValue(mockLean({ active: false }));
    await esClubActivo('CARC');
    await esClubActivo('CARC');
    expect(Club.findOne).toHaveBeenCalledTimes(1);
  });

  it('invalidarClubActivo fuerza a recalcular en la siguiente consulta', async () => {
    Club.findOne.mockReturnValue(mockLean({ active: true }));
    expect(await esClubActivo('CARC')).toBe(true);

    invalidarClubActivo('CARC');
    Club.findOne.mockReturnValue(mockLean({ active: false }));
    expect(await esClubActivo('CARC')).toBe(false);
    expect(Club.findOne).toHaveBeenCalledTimes(2);
  });
});
