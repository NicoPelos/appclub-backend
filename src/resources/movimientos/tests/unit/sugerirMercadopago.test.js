import { afterEach, describe, expect, it, vi } from 'vitest';
import { sugerirMovimientoParaPago } from '../../services/sugerirMercadopago.service.js';
import Movimiento from '../../models/Movimiento.js';
import * as pagadorHistorico from '../../services/pagadorHistorico.service.js';

afterEach(() => vi.restoreAllMocks());

const mockFind = (resultado) => {
  Movimiento.find = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(resultado) });
};

describe('sugerirMovimientoParaPago', () => {
  it('should suggest creating a new Movimiento when nothing matches, with a suggested socio from payer history', async () => {
    mockFind([]);
    vi.spyOn(pagadorHistorico, 'buscarSocioPorPagadorHistorico').mockResolvedValue({ socioId: 'socioA', socioNombre: 'Hijo A' });

    const resultado = await sugerirMovimientoParaPago({
      clubId: 'club1', monto: 15000, fecha: '2026-10-05', payerEmail: 'mama@test.com', direccion: 'ingreso',
    });

    expect(resultado.tipo).toBe('crear');
    expect(resultado.datosSugeridos).toMatchObject({
      monto: 15000, type: 'Ingreso', payerEmail: 'mama@test.com', socioSugerido: { socioId: 'socioA', socioNombre: 'Hijo A' },
    });
  });

  it('should suggest linking when there is a single candidate', async () => {
    mockFind([{ _id: 'mov1', amount: 15000, date: '2026-10-05T12:00:00.000Z', socioId: 'socioA', mercadopagoVinculos: [] }]);
    vi.spyOn(pagadorHistorico, 'coincideConHistorialDelSocio').mockResolvedValue(false);

    const resultado = await sugerirMovimientoParaPago({ clubId: 'club1', monto: 15000, fecha: '2026-10-05', direccion: 'ingreso' });

    expect(resultado.tipo).toBe('vincular');
    expect(resultado.candidatos).toHaveLength(1);
  });

  it('should ask to review when two candidates of the same amount tie on payer history', async () => {
    mockFind([
      { _id: 'mov1', amount: 15000, date: '2026-10-05T12:00:00.000Z', socioId: 'socioA', mercadopagoVinculos: [] },
      { _id: 'mov2', amount: 15000, date: '2026-10-05T18:00:00.000Z', socioId: 'socioB', mercadopagoVinculos: [] },
    ]);
    vi.spyOn(pagadorHistorico, 'coincideConHistorialDelSocio').mockResolvedValue(false);

    const resultado = await sugerirMovimientoParaPago({ clubId: 'club1', monto: 15000, fecha: '2026-10-05', direccion: 'ingreso' });

    expect(resultado.tipo).toBe('revisar');
    expect(resultado.candidatos).toHaveLength(2);
  });

  it('should break the tie and suggest linking when only one of two same-amount candidates matches the payer history', async () => {
    mockFind([
      { _id: 'mov1', amount: 15000, date: '2026-10-05T12:00:00.000Z', socioId: 'socioA', mercadopagoVinculos: [] },
      { _id: 'mov2', amount: 15000, date: '2026-10-05T12:30:00.000Z', socioId: 'socioB', mercadopagoVinculos: [] },
    ]);
    vi.spyOn(pagadorHistorico, 'coincideConHistorialDelSocio').mockImplementation(async ({ socioId }) => socioId === 'socioB');

    const resultado = await sugerirMovimientoParaPago({
      clubId: 'club1', monto: 15000, fecha: '2026-10-05', payerEmail: 'mama-de-b@test.com', direccion: 'ingreso',
    });

    expect(resultado.tipo).toBe('vincular');
    expect(resultado.candidatos[0]._id).toBe('mov2');
  });
});
