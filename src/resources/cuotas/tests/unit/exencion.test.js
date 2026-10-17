import { describe, it, expect, vi, beforeEach } from 'vitest';

// Caracterización (appcarc-backend#263, docs/specs/cuotas-calcularDeuda.md §3).
// El resultado contra datos reales está en exencion.integration.test.js.
vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({ default: { exists: vi.fn() } }));

import { estaExentoEnPeriodo } from '../../services/exencion.service.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';

const mockExists = (resultado) => {
  const query = Promise.resolve(resultado);
  query.session = vi.fn().mockResolvedValue(resultado);
  Suscripcion.exists.mockReturnValue(query);
  return query;
};

const args = { clubId: 'CARC', socioId: 's1', etiquetaId: 'etq1', periodo: '2026-10' };

beforeEach(() => vi.clearAllMocks());

describe('estaExentoEnPeriodo', () => {
  it('C19: sin socioId o sin etiquetaId devuelve false sin consultar la base', async () => {
    await expect(estaExentoEnPeriodo({ ...args, socioId: null })).resolves.toBe(false);
    await expect(estaExentoEnPeriodo({ ...args, etiquetaId: undefined })).resolves.toBe(false);
    expect(Suscripcion.exists).not.toHaveBeenCalled();
  });

  it('busca un tramo activo y exento que contenga el período (bordes inclusivos, fechaHasta null = abierto)', async () => {
    mockExists({ _id: 'sus1' });
    await estaExentoEnPeriodo(args);
    expect(Suscripcion.exists).toHaveBeenCalledWith({
      clubId: 'CARC',
      socioId: 's1',
      etiquetaId: 'etq1',
      active: true,
      exento: true,
      fechaDesde: { $lte: '2026-10' },
      $or: [{ fechaHasta: null }, { fechaHasta: { $gte: '2026-10' } }],
    });
  });

  it('convierte el resultado de exists() a booleano', async () => {
    mockExists({ _id: 'sus1' });
    await expect(estaExentoEnPeriodo(args)).resolves.toBe(true);
    mockExists(null);
    await expect(estaExentoEnPeriodo(args)).resolves.toBe(false);
  });

  it('con sesión, la consulta corre dentro de esa sesión; sin sesión no la toca', async () => {
    const session = { id: 'sess' };
    const q = mockExists({ _id: 'sus1' });
    await expect(estaExentoEnPeriodo({ ...args, session })).resolves.toBe(true);
    expect(q.session).toHaveBeenCalledWith(session);

    const q2 = mockExists({ _id: 'sus1' });
    await estaExentoEnPeriodo(args);
    expect(q2.session).not.toHaveBeenCalled();
  });
});
