import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Precios.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findById: vi.fn() },
}));

import { resolverVigenciaPrecio, BusinessError, RequiereConfirmacionError } from '../../services/resolverVigenciaPrecio.service.js';
import Precios from '../../models/Precios.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';

const CLUB_ID = 'CARC';
const ETIQUETA_ID = 'etq1';

const mockOtros = (docs) => {
  Precios.find.mockReturnValue({ session: vi.fn().mockResolvedValue(docs) });
};

const fakePrecio = ({ id, nombre, desde, hasta = null }) => ({
  _id: id,
  nombre,
  vigenteDesde: desde,
  vigenteHasta: hasta,
  save: vi.fn().mockResolvedValue(undefined),
});

beforeEach(() => {
  vi.clearAllMocks();
  Etiqueta.findById.mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ nombre: 'Cuota Social' }) }) });
});

describe('resolverVigenciaPrecio', () => {
  it('no hace nada si no hay otros precios de la etiqueta', async () => {
    mockOtros([]);
    await expect(resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: null,
    })).resolves.toBeUndefined();
  });

  it('rechaza (BusinessError) si otro precio activo arranca exactamente el mismo día', async () => {
    mockOtros([fakePrecio({ id: 'p1', nombre: 'Cuota Social', desde: new Date('2026-08-01') })]);

    await expect(resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: null,
    })).rejects.toBeInstanceOf(BusinessError);
  });

  it('rechaza si el nuevo se metería encima de uno que ya está programado para después', async () => {
    // nuevo: agosto sin fin. otro ya programado: arranca en septiembre.
    mockOtros([fakePrecio({ id: 'p1', nombre: 'Cuota Social Sep', desde: new Date('2026-09-01') })]);

    await expect(resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: null,
    })).rejects.toBeInstanceOf(BusinessError);
  });

  it('NO rechaza si el nuevo termina antes de que arranque el programado más adelante', async () => {
    mockOtros([fakePrecio({ id: 'p1', nombre: 'Cuota Social Sep', desde: new Date('2026-09-01') })]);

    await expect(resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: new Date('2026-08-31'),
    })).resolves.toBeUndefined();
  });

  it('pide confirmación (RequiereConfirmacionError) si hay un precio anterior abierto que se solaparía', async () => {
    mockOtros([fakePrecio({ id: 'p1', nombre: 'Cuota Social', desde: new Date('2026-06-26'), hasta: null })]);

    const err = await resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: null,
    }).catch((e) => e);

    expect(err).toBeInstanceOf(RequiereConfirmacionError);
    expect(err.precios).toEqual([expect.objectContaining({ id: 'p1' })]);
  });

  it('con confirmado:true, cierra el precio anterior el día antes de que arranque el nuevo', async () => {
    const anterior = fakePrecio({ id: 'p1', nombre: 'Cuota Social', desde: new Date('2026-06-26'), hasta: null });
    mockOtros([anterior]);

    await resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01T00:00:00.000Z'), hasta: null,
      confirmado: true,
    });

    expect(anterior.vigenteHasta.toISOString()).toBe('2026-07-31T00:00:00.000Z');
    expect(anterior.save).toHaveBeenCalled();
  });

  it('no toca precios cuyo rango ya termina antes de que arranque el nuevo', async () => {
    const yaCerrado = fakePrecio({ id: 'p1', nombre: 'Cuota Vieja', desde: new Date('2026-01-01'), hasta: new Date('2026-06-30') });
    mockOtros([yaCerrado]);

    await resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: null,
      confirmado: true,
    });

    expect(yaCerrado.save).not.toHaveBeenCalled();
  });

  it('excluye el propio precio (excludeId) al buscar conflictos, para poder editar sin chocar consigo mismo', async () => {
    mockOtros([]); // el mock de find ya asume que excludeId lo filtró en la query real
    await resolverVigenciaPrecio({
      clubId: CLUB_ID, etiquetaId: ETIQUETA_ID,
      desde: new Date('2026-08-01'), hasta: null,
      excludeId: 'propio1',
    });
    expect(Precios.find).toHaveBeenCalledWith(expect.objectContaining({ _id: { $ne: 'propio1' } }));
  });
});

// Caracterización (appcarc-backend#263, docs/specs/cuotas-calcularDeuda.md §4).
describe('resolverVigenciaPrecio — caracterización (#263)', () => {
  const D = (iso) => new Date(iso);
  const resolver = (args) => resolverVigenciaPrecio({ clubId: CLUB_ID, etiquetaId: ETIQUETA_ID, ...args });

  it('busca solo precios activos del club y la etiqueta, y sin excludeId no filtra por _id', async () => {
    mockOtros([]);
    await resolver({ desde: D('2026-08-01'), hasta: null });
    expect(Precios.find).toHaveBeenCalledWith({ clubId: CLUB_ID, etiquetaId: ETIQUETA_ID, active: true });
  });

  it('pasa la sesión a la búsqueda, a la etiqueta y a cada save; sin sesión usa null', async () => {
    const session = { id: 'sess' };
    const anterior = fakePrecio({ id: 'p1', desde: D('2026-06-01T00:00:00Z') });
    const findSession = vi.fn().mockResolvedValue([anterior]);
    Precios.find.mockReturnValue({ session: findSession });
    const etiquetaSession = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ nombre: 'X' }) });
    Etiqueta.findById.mockReturnValue({ session: etiquetaSession });

    await resolver({ desde: D('2026-08-01T00:00:00Z'), hasta: null, confirmado: true, session });

    expect(findSession).toHaveBeenCalledWith(session);
    expect(Etiqueta.findById).toHaveBeenCalledWith(ETIQUETA_ID);
    expect(etiquetaSession).toHaveBeenCalledWith(session);
    expect(anterior.save).toHaveBeenCalledWith({ session });

    mockOtros([]);
    Etiqueta.findById.mockReturnValue({ session: etiquetaSession });
    await resolver({ desde: D('2026-08-01'), hasta: null });
    expect(etiquetaSession).toHaveBeenLastCalledWith(null);
  });

  it('V1: el error de empate es 409, nombra la etiqueta y gana antes que el chequeo de posterior', async () => {
    mockOtros([
      fakePrecio({ id: 'p1', desde: D('2026-09-01') }),
      fakePrecio({ id: 'p2', desde: D('2026-08-01') }),
    ]);
    const err = await resolver({ desde: D('2026-08-01'), hasta: null }).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.status).toBe(409);
    expect(err.name).toBe('BusinessError');
    expect(err.message).toContain('"Cuota Social"');
    expect(err.message).toContain('también arranca');
  });

  it('si la etiqueta no existe, los mensajes dicen "esta etiqueta"', async () => {
    Etiqueta.findById.mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    mockOtros([fakePrecio({ id: 'p1', desde: D('2026-08-01') })]);
    const err = await resolver({ desde: D('2026-08-01'), hasta: null }).catch((e) => e);
    expect(err.message).toContain('"esta etiqueta"');
  });

  it('C17: V2 rechaza también cuando hasta cae justo el día en que arranca el posterior (borde >=)', async () => {
    mockOtros([fakePrecio({ id: 'p1', desde: D('2026-09-01') })]);
    const err = await resolver({ desde: D('2026-08-01'), hasta: D('2026-09-01') }).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.status).toBe(409);
    expect(err.message).toContain('programado para empezar');
  });

  it('V2: hasta 1 ms antes de que arranque el posterior no rechaza', async () => {
    mockOtros([fakePrecio({ id: 'p1', desde: D('2026-09-01T00:00:00.000Z') })]);
    await expect(resolver({ desde: D('2026-08-01'), hasta: D('2026-08-31T23:59:59.999Z') })).resolves.toBeUndefined();
  });

  it('V3: RequiereConfirmacionError es 409, propone cerrar en desde − 24 h y lista todos los anteriores abiertos', async () => {
    mockOtros([
      fakePrecio({ id: 'p1', desde: D('2026-01-01') }),
      fakePrecio({ id: 'p2', desde: D('2026-06-01'), hasta: D('2026-12-31') }),
    ]);
    const err = await resolver({ desde: D('2026-08-01T00:00:00.000Z'), hasta: null }).catch((e) => e);
    expect(err).toBeInstanceOf(RequiereConfirmacionError);
    expect(err.status).toBe(409);
    expect(err.name).toBe('RequiereConfirmacionError');
    expect(err.message).toContain('"Cuota Social"');
    expect(err.precios).toEqual([
      { id: 'p1', cierrePropuesto: D('2026-07-31T00:00:00.000Z') },
      { id: 'p2', cierrePropuesto: D('2026-07-31T00:00:00.000Z') },
    ]);
  });

  it('V3: un anterior cuyo vigenteHasta es exactamente desde se cierra (borde >=); uno que termina 1 ms antes no', async () => {
    const tocaJusto = fakePrecio({ id: 'p1', desde: D('2026-01-01'), hasta: D('2026-08-01T00:00:00.000Z') });
    const terminaAntes = fakePrecio({ id: 'p2', desde: D('2025-01-01'), hasta: D('2026-07-31T23:59:59.999Z') });
    mockOtros([tocaJusto, terminaAntes]);
    await resolver({ desde: D('2026-08-01T00:00:00.000Z'), hasta: null, confirmado: true });
    expect(tocaJusto.save).toHaveBeenCalledTimes(1);
    expect(tocaJusto.vigenteHasta).toEqual(D('2026-07-31T00:00:00.000Z'));
    expect(terminaAntes.save).not.toHaveBeenCalled();
  });

  it('D5: rechaza (409) si cerrar un anterior que termina después del nuevo dejaría meses sin precio, aun confirmado, y no lo toca', async () => {
    const anterior = fakePrecio({ id: 'p1', desde: D('2026-06-01T00:00:00Z'), hasta: D('2026-12-31T00:00:00Z') });
    mockOtros([anterior]);
    const err = await resolver({ desde: D('2026-08-01T00:00:00Z'), hasta: D('2026-08-31T00:00:00Z'), confirmado: true }).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.status).toBe(409);
    expect(err.message).toContain('"Cuota Social"');
    expect(err.message).toContain('sin precio');
    expect(anterior.vigenteHasta).toEqual(D('2026-12-31T00:00:00Z'));
    expect(anterior.save).not.toHaveBeenCalled();
  });

  it('D5: sin confirmar también rechaza con BusinessError, no pregunta si cerrar', async () => {
    mockOtros([fakePrecio({ id: 'p1', desde: D('2026-06-01T00:00:00Z'), hasta: D('2026-12-31T00:00:00Z') })]);
    const err = await resolver({ desde: D('2026-08-01T00:00:00Z'), hasta: D('2026-08-31T00:00:00Z') }).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect(err).not.toBeInstanceOf(RequiereConfirmacionError);
  });

  it('D5: un anterior abierto (sin vigenteHasta) y un nuevo con hasta también dejaría un hueco: rechaza', async () => {
    const anterior = fakePrecio({ id: 'p1', desde: D('2026-06-01T00:00:00Z') });
    mockOtros([anterior]);
    const err = await resolver({ desde: D('2026-08-01T00:00:00Z'), hasta: D('2026-08-31T00:00:00Z'), confirmado: true }).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect(anterior.save).not.toHaveBeenCalled();
  });

  it('D5: si el anterior termina justo cuando termina el nuevo no queda hueco y se cierra normalmente', async () => {
    const anterior = fakePrecio({ id: 'p1', desde: D('2026-06-01T00:00:00Z'), hasta: D('2026-08-31T00:00:00Z') });
    mockOtros([anterior]);
    await resolver({ desde: D('2026-08-01T00:00:00Z'), hasta: D('2026-08-31T00:00:00Z'), confirmado: true });
    expect(anterior.vigenteHasta).toEqual(D('2026-07-31T00:00:00Z'));
    expect(anterior.save).toHaveBeenCalledTimes(1);
  });

  it('D5: rechaza (400) un hasta anterior a desde, antes de consultar la base', async () => {
    mockOtros([]);
    const err = await resolver({ desde: D('2026-08-01'), hasta: D('2026-07-01') }).catch((e) => e);
    expect(err).toBeInstanceOf(BusinessError);
    expect(err.status).toBe(400);
    expect(err.message).toContain('anterior a la de inicio');
    expect(Precios.find).not.toHaveBeenCalled();
  });

  it('D5: hasta igual a desde (precio de un solo instante) se acepta', async () => {
    mockOtros([]);
    await expect(resolver({ desde: D('2026-08-01'), hasta: D('2026-08-01') })).resolves.toBeUndefined();
  });
});
