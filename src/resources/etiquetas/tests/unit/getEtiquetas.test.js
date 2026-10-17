import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getEtiquetasHandler } from '../../handlers/getEtiquetas.handler.js';

vi.mock('../../models/Etiqueta.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../cuotas/models/Precios.js', () => ({
  default: { find: vi.fn() },
}));

import Etiqueta from '../../models/Etiqueta.js';
import Precios from '../../../cuotas/models/Precios.js';

const mockUser = { clubId: 'CARC' };

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

const mockPrecios = (result = []) => {
  Precios.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(result) }) });
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrecios();
});

describe('getEtiquetasHandler', () => {
  it('devuelve lista de etiquetas activas con precioVigente', async () => {
    const etiquetaId = '507f1f77bcf86cd799439011';
    const etiquetas = [{ _id: etiquetaId, nombre: 'Cuota Social', unidad: 'mes' }];
    Etiqueta.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(etiquetas) }) });
    mockPrecios([{ etiquetaId, monto: 6000 }]);

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getEtiquetasHandler(req, res);

    expect(Etiqueta.find).toHaveBeenCalledWith(expect.objectContaining({ active: true }));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith([{ ...etiquetas[0], precioVigente: 6000 }]);
  });

  it('precioVigente queda null si la etiqueta no tiene ningún precio configurado', async () => {
    const etiquetas = [{ _id: '507f1f77bcf86cd799439011', nombre: 'Sin precio', unidad: 'mes' }];
    Etiqueta.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(etiquetas) }) });

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getEtiquetasHandler(req, res);

    expect(res.json).toHaveBeenCalledWith([{ ...etiquetas[0], precioVigente: null }]);
  });

  it('filtra por uso_sistema', async () => {
    Etiqueta.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });

    const req = { user: mockUser, query: { uso_sistema: 'cuota_social' } };
    const res = mockRes();

    await getEtiquetasHandler(req, res);

    expect(Etiqueta.find).toHaveBeenCalledWith(expect.objectContaining({ uso_sistema: 'cuota_social' }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('muestra eliminadas con trash=true', async () => {
    Etiqueta.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });

    const req = { user: mockUser, query: { trash: 'true' } };
    const res = mockRes();

    await getEtiquetasHandler(req, res);

    expect(Etiqueta.find).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('retorna 500 si hay error', async () => {
    Etiqueta.find.mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockRejectedValue(new Error('DB error')) }) });

    const req = { user: mockUser, query: {} };
    const res = mockRes();

    await getEtiquetasHandler(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});
