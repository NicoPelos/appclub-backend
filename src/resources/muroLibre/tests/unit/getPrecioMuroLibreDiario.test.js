import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../services/registrarMuroLibre.service.js', () => ({
  findPrecioVigenteByUsoSistema: vi.fn(),
  USO_SISTEMA_BY_TIPO: { diario: { socio: 'muro_libre_diario_socio', noSocio: 'muro_libre_diario_no_socio' } },
}));

vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));

import { getPrecioMuroLibreDiarioHandler } from '../../handlers/getPrecioMuroLibreDiario.handler.js';
import { findPrecioVigenteByUsoSistema } from '../../services/registrarMuroLibre.service.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';

const ETIQUETA_ID = '507f1f77bcf86cd799439088';

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
};

describe('getPrecioMuroLibreDiarioHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-01T10:00:00.000-03:00'));
  });
  afterEach(() => vi.useRealTimers());

  it('devuelve el monto vigente', async () => {
    findPrecioVigenteByUsoSistema.mockResolvedValue({ monto: 5000 });
    const res = mockRes();

    await getPrecioMuroLibreDiarioHandler({ query: { esSocio: 'true' }, user: { clubId: 'CARC' } }, res);

    expect(findPrecioVigenteByUsoSistema).toHaveBeenCalledWith(expect.objectContaining({ clubId: 'CARC', uso_sistema: 'muro_libre_diario_socio' }));
    expect(res.json).toHaveBeenCalledWith({ monto: 5000 });
    expect(Etiqueta.findOne).not.toHaveBeenCalled();
  });

  it('#317: sin precio vigente responde monto null con PRECIO_NO_VIGENTE y el nombre del pase', async () => {
    findPrecioVigenteByUsoSistema.mockResolvedValue(null);
    Etiqueta.findOne.mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: ETIQUETA_ID, nombre: 'Muro Libre diario no socio' }) });
    const res = mockRes();

    await getPrecioMuroLibreDiarioHandler({ query: { esSocio: 'false' }, user: { clubId: 'CARC' } }, res);

    expect(Etiqueta.findOne).toHaveBeenCalledWith({ clubId: 'CARC', uso_sistema: 'muro_libre_diario_no_socio', active: true });
    expect(res.status).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({
      monto: null,
      message: 'No hay precio vigente para «Muro Libre diario no socio» en diciembre 2026. Cargalo o actualizalo en Etiquetas → Precios para completar la operación.',
      code: 'PRECIO_NO_VIGENTE',
      etiquetaId: ETIQUETA_ID,
      etiquetaNombre: 'Muro Libre diario no socio',
      periodo: '2026-12',
    });
  });
});
