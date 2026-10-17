import { describe, it, expect, vi, beforeEach } from 'vitest';

// Caracterización (appcarc-backend#263, docs/specs/cuotas-calcularDeuda.md §2).
// La regla vive en la query de Mongo: acá se fija su forma; el resultado
// contra datos reales está en findPrecioVigente.integration.test.js.
vi.mock('../../models/Precios.js', () => ({ default: { findOne: vi.fn() } }));

import { findPrecioVigente } from '../../services/findPrecioVigente.service.js';
import Precios from '../../models/Precios.js';

const precio = { _id: 'p1', monto: 15000 };
let chain;
let query;

beforeEach(() => {
  vi.clearAllMocks();
  query = Object.assign(Promise.resolve(precio), { session: vi.fn().mockResolvedValue(precio) });
  chain = {
    sort: vi.fn().mockReturnThis(),
    lean: vi.fn().mockReturnValue(query),
  };
  Precios.findOne.mockReturnValue(chain);
});

describe('findPrecioVigente', () => {
  const date = new Date('2026-10-11T15:00:00Z');

  it('busca activo, del club y la etiqueta, con vigenteDesde <= date y vigenteHasta null o >= date', async () => {
    await findPrecioVigente({ clubId: 'CARC', etiquetaId: 'etq1', date });
    expect(Precios.findOne).toHaveBeenCalledWith({
      clubId: 'CARC',
      etiquetaId: 'etq1',
      active: true,
      vigenteDesde: { $lte: date },
      $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: date } }],
    });
  });

  it('si hay varios, se queda con el de vigenteDesde más reciente', async () => {
    await findPrecioVigente({ clubId: 'CARC', etiquetaId: 'etq1', date });
    expect(chain.sort).toHaveBeenCalledWith({ vigenteDesde: -1 });
    expect(chain.lean).toHaveBeenCalled();
  });

  it('sin sesión devuelve el resultado de la query lean', async () => {
    await expect(findPrecioVigente({ clubId: 'CARC', etiquetaId: 'etq1', date })).resolves.toBe(precio);
    expect(query.session).not.toHaveBeenCalled();
  });

  it('con sesión, la query corre dentro de esa sesión', async () => {
    const session = { id: 'sess' };
    await expect(findPrecioVigente({ clubId: 'CARC', etiquetaId: 'etq1', date, session })).resolves.toBe(precio);
    expect(query.session).toHaveBeenCalledWith(session);
  });
});
