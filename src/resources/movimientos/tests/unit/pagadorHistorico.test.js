import { afterEach, describe, expect, it, vi } from 'vitest';
import { buscarSocioPorPagadorHistorico, coincideConHistorialDelSocio } from '../../services/pagadorHistorico.service.js';
import Movimiento from '../../models/Movimiento.js';

afterEach(() => vi.restoreAllMocks());

describe('coincideConHistorialDelSocio', () => {
  it('should return false when there is no socioId', async () => {
    const result = await coincideConHistorialDelSocio({ clubId: 'club1', socioId: null, payerEmail: 'a@test.com' });
    expect(result).toBe(false);
  });

  it('should return false when there is no email nor name to check', async () => {
    const result = await coincideConHistorialDelSocio({ clubId: 'club1', socioId: 'socio1', payerEmail: '', payerName: '' });
    expect(result).toBe(false);
  });

  it('should return true when a past vínculo of the same socio used that email', async () => {
    Movimiento.exists = vi.fn().mockResolvedValue(true);
    const result = await coincideConHistorialDelSocio({ clubId: 'club1', socioId: 'socio1', payerEmail: 'mama@test.com' });
    expect(result).toBe(true);
    expect(Movimiento.exists).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'club1', active: true, socioId: 'socio1' }));
  });

  it('should match by payerName when there is no email', async () => {
    Movimiento.exists = vi.fn().mockResolvedValue(true);
    await coincideConHistorialDelSocio({ clubId: 'club1', socioId: 'socio1', payerName: 'Ana Pérez' });
    const query = Movimiento.exists.mock.calls[0][0];
    expect(query.$or).toEqual([
      { 'mercadopagoVinculos.payerName': { $regex: '^Ana Pérez$', $options: 'i' } },
    ]);
  });
});

describe('buscarSocioPorPagadorHistorico', () => {
  it('should return null when there is no email nor name', async () => {
    const result = await buscarSocioPorPagadorHistorico({ clubId: 'club1', payerEmail: '', payerName: '' });
    expect(result).toBeNull();
  });

  it('should return null when nothing matches', async () => {
    Movimiento.find = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
    const result = await buscarSocioPorPagadorHistorico({ clubId: 'club1', payerEmail: 'desconocido@test.com' });
    expect(result).toBeNull();
  });

  it('should return the most frequent socio among matches', async () => {
    Movimiento.find = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue([
          { socioId: 'socioA', socioNombre: 'Hijo A' },
          { socioId: 'socioA', socioNombre: 'Hijo A' },
          { socioId: 'socioB', socioNombre: 'Hijo B' },
        ]),
      }),
    });
    const result = await buscarSocioPorPagadorHistorico({ clubId: 'club1', payerEmail: 'mama@test.com' });
    expect(result).toEqual({ socioId: 'socioA', socioNombre: 'Hijo A' });
  });
});
