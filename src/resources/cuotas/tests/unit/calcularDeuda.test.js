import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calcularDeuda } from '../../services/calcularDeuda.service.js';

const mockCuotaFindOne = vi.fn();
const mockCuotaFind = vi.fn();
const mockPreciosFindOne = vi.fn();
const mockPreciosFind = vi.fn();
const mockSuscripcionFind = vi.fn();
const mockAsistenciaFind = vi.fn();
const mockCargoPuntualFind = vi.fn();
const mockEventoParticipanteFind = vi.fn();

vi.mock('../../models/Cuota.js', () => ({
  default: {
    findOne: (...args) => mockCuotaFindOne(...args),
    find: (...args) => mockCuotaFind(...args),
  },
}));

vi.mock('../../models/Precios.js', () => ({
  default: {
    findOne: (...args) => mockPreciosFindOne(...args),
    find: (...args) => mockPreciosFind(...args),
  },
}));

vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({
  default: {
    find: (...args) => mockSuscripcionFind(...args),
  },
}));

vi.mock('../../../asistencias/models/Asistencia.js', () => ({
  default: {
    find: (...args) => mockAsistenciaFind(...args),
  },
}));

vi.mock('../../../cargosPuntuales/models/CargoPuntual.js', () => ({
  default: {
    find: (...args) => mockCargoPuntualFind(...args),
  },
}));

vi.mock('../../../eventos/models/EventoParticipante.js', () => ({
  default: {
    find: (...args) => mockEventoParticipanteFind(...args),
  },
}));

const chainableAsistencia = (result = []) => ({
  select: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

const chainableCargoPuntual = (result = []) => ({
  populate: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

const chainableEventoParticipante = (result = []) => ({
  populate: vi.fn().mockReturnThis(),
  sort: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

const mockEtiquetaSocial = { _id: 'etq_social_id', nombre: 'Cuota Social', unidad: 'mes', uso_sistema: 'cuota_social' };

const mockSuscripcion = (overrides = {}) => ({
  _id: 'sus_001',
  socioId: 'socio_001',
  etiquetaId: mockEtiquetaSocial,
  fechaDesde: '2026-03',
  fechaHasta: null,
  active: true,
  ...overrides,
});

const chainableCuota = (result = null) => ({
  sort: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

const chainablePrecio = (result = null) => ({
  sort: vi.fn().mockReturnThis(),
  populate: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

const chainableSuscripcion = (result = []) => ({
  populate: vi.fn().mockReturnThis(),
  lean: vi.fn().mockResolvedValue(result),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockAsistenciaFind.mockReturnValue(chainableAsistencia([]));
  mockCargoPuntualFind.mockReturnValue(chainableCargoPuntual([]));
  mockEventoParticipanteFind.mockReturnValue(chainableEventoParticipante([]));
  // Precios de cada mes (#285): por defecto ninguno; los tests de precio
  // histórico cargan los suyos.
  mockPreciosFind.mockReturnValue(chainablePrecio([]));
});

describe('calcularDeuda', () => {
  it('retorna array vacío si el socio no tiene suscripciones', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones).toEqual([]);
    expect(result.otrosCargos).toEqual([]);
  });

  it('trae todas las suscripciones activas, sin filtrar por fechaHasta', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));

    await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(mockSuscripcionFind).toHaveBeenCalledWith({
      socioId: 'socio_001',
      clubId: 'CARC',
      active: true,
    });
  });

  it('incluye una suscripción cerrada con fechaHasta pasado si le queda un período sin pagar (appcarc-backend#46)', async () => {
    // Reproduce el bug real encontrado al probar /excluir-periodo: un tramo
    // cerrado con fechaHasta anterior a hoy no debe desaparecer de la deuda
    // si todavía tiene periodos sin pagar dentro de su propio rango.
    const sus = mockSuscripcion({ fechaDesde: '2026-02', fechaHasta: '2026-05' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFindOne.mockReturnValue(chainableCuota({ periodo: '2026-04' }));
    mockCuotaFind.mockReturnValue(chainableCuota([
      { periodo: '2026-02' }, { periodo: '2026-03' }, { periodo: '2026-04' },
    ]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones).toHaveLength(1);
    expect(result.suscripciones[0].periodos).toEqual(['2026-05']);
    expect(result.suscripciones[0].totalDeuda).toBe(15000);
  });

  it('incluye periodosPagados con todo el historial de cuotas pagadas de la etiqueta', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2026-06' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([{ periodo: '2026-01' }, { periodo: '2026-02' }]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].periodosPagados).toEqual(['2026-01', '2026-02']);
  });

  it('una suscripción exenta sin pagos previos devuelve periodosPagados vacío', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2026-06', exento: true });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFind.mockReturnValue(chainableCuota([]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].periodosPagados).toEqual([]);
  });

  it('incluye suscripcionId y etiqueta en el resultado', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2026-06' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].suscripcionId).toBe('sus_001');
    expect(result.suscripciones[0].etiqueta).toEqual(mockEtiquetaSocial);
    expect(result.suscripciones[0].precioUnitario).toBe(15000);
  });

  it('deuda 0 si fechaDesde es futura', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2027-01' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].mesesDeuda).toBe(0);
    expect(result.suscripciones[0].totalDeuda).toBe(0);
  });

  it('una suscripción a futuro no debe nada pero trae el precio vigente para sugerir el monto del adelanto', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2027-01' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].totalDeuda).toBe(0);
    expect(result.suscripciones[0].precioUnitario).toBe(15000);
  });

  it('una suscripción a futuro sin precio configurado devuelve precioUnitario null', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2027-01' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio(null));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].precioUnitario).toBeNull();
  });

  it('totalDeuda es null cuando no hay precio configurado', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2026-05' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio(null));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].precioUnitario).toBeNull();
    expect(result.suscripciones[0].totalDeuda).toBeNull();
  });

  it('descuenta períodos ya pagados', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2026-04' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFindOne.mockReturnValue(chainableCuota({ periodo: '2026-04' }));
    mockCuotaFind.mockReturnValue(chainableCuota([{ periodo: '2026-04' }, { periodo: '2026-05' }]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    // de 2026-04 a hoy (2026-06): 3 períodos, 2 pagados → 1 pendiente
    expect(result.suscripciones[0].mesesDeuda).toBeGreaterThanOrEqual(0);
    expect(result.suscripciones[0].periodos).not.toContain('2026-04');
    expect(result.suscripciones[0].periodos).not.toContain('2026-05');
  });

  it('procesa múltiples suscripciones independientemente', async () => {
    const sus1 = mockSuscripcion({ _id: 'sus_001', fechaDesde: '2026-06', etiquetaId: mockEtiquetaSocial });
    const sus2 = mockSuscripcion({ _id: 'sus_002', fechaDesde: '2026-06', etiquetaId: { _id: 'etq_esc_id', nombre: 'Escuelita 2x', unidad: 'mes', uso_sistema: null } });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus1, sus2]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 10000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones).toHaveLength(2);
    expect(result.suscripciones[0].suscripcionId).toBe('sus_001');
    expect(result.suscripciones[1].suscripcionId).toBe('sus_002');
  });

  it('exento: mesesDeuda y totalDeuda en 0, pero sigue devolviendo periodosPagados', async () => {
    // Un tramo exento (ej. plan Staff) puede convivir con meses ya pagados
    // de antes de pasar a exento — la grilla de edición de meses necesita
    // ese dato para pintarlos en verde (caso real de un socio de staff).
    const sus = mockSuscripcion({ fechaDesde: '2020-01', exento: true });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFind.mockReturnValue(chainableCuota([{ periodo: '2026-01' }, { periodo: '2026-02' }]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.suscripciones[0].mesesDeuda).toBe(0);
    expect(result.suscripciones[0].totalDeuda).toBe(0);
    expect(result.suscripciones[0].periodos).toEqual([]);
    expect(result.suscripciones[0].periodosPagados).toEqual(['2026-01', '2026-02']);
    expect(result.suscripciones[0].exento).toBe(true);
    expect(mockCuotaFindOne).not.toHaveBeenCalled();
  });

  it('respeta fechaHasta de suscripcion cerrada', async () => {
    const sus = mockSuscripcion({ fechaDesde: '2026-01', fechaHasta: '2026-03' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([sus]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    // Solo genera deuda de 2026-01 a 2026-03 (3 períodos)
    expect(result.suscripciones[0].periodos.every((p) => p <= '2026-03')).toBe(true);
  });

  it('otrosCargos es un array vacío si no hay visitas pendientes', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockAsistenciaFind.mockReturnValue(chainableAsistencia([]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toEqual([]);
  });

  it('otrosCargos suma las visitas pendientes de check-in de muro libre', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockAsistenciaFind.mockReturnValue(chainableAsistencia([
      { _id: 'asis_001', fecha: '2026-06-01T12:00:00Z', precioSugeridoSnapshot: 2000 },
      { _id: 'asis_002', fecha: '2026-06-08T12:00:00Z', precioSugeridoSnapshot: 2500 },
    ]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toEqual([{
      tipo: 'muro_libre',
      nombre: 'Muro Libre',
      cantidadPendiente: 2,
      unidadPendiente: 'visita',
      fechas: ['2026-06-01T12:00:00Z', '2026-06-08T12:00:00Z'],
      visitas: [
        { asistenciaId: 'asis_001', fecha: '2026-06-01T12:00:00Z', monto: 2000 },
        { asistenciaId: 'asis_002', fecha: '2026-06-08T12:00:00Z', monto: 2500 },
      ],
      totalDeuda: 4500,
    }]);
    expect(mockAsistenciaFind).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC',
      socioId: 'socio_001',
      tipo: 'muro_libre',
      tipoPase: 'diario',
      active: true,
      estadoPago: 'pendiente',
    }));
  });

  it('el cargo de muro libre trata precioSugeridoSnapshot null como 0', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockAsistenciaFind.mockReturnValue(chainableAsistencia([
      { _id: 'asis_001', fecha: '2026-06-01T12:00:00Z', precioSugeridoSnapshot: null },
    ]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos[0]).toEqual(expect.objectContaining({
      cantidadPendiente: 1,
      totalDeuda: 0,
    }));
  });

  it('otrosCargos incluye un cargo puntual pendiente por socio', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockCargoPuntualFind.mockReturnValue(chainableCargoPuntual([{
      _id: 'cargo_001',
      etiquetaId: { nombre: 'Trekking a Cerro Negro' },
      description: 'Viaje del 15/8',
      montoEsperadoSnapshot: 200000,
      estado: 'pendiente',
    }]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toEqual([{
      tipo: 'cargo_puntual',
      cargoPuntualId: 'cargo_001',
      nombre: 'Trekking a Cerro Negro',
      descripcion: 'Viaje del 15/8',
      totalDeuda: 200000,
      estado: 'pendiente',
      montoPagado: 0,
    }]);
    expect(mockCargoPuntualFind).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: 'socio_001', estado: { $in: ['pendiente', 'parcial'] }, active: true,
    }));
  });

  it('appcarc-backend#168: un cargo puntual parcial muestra el SALDO restante, no el monto original', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockCargoPuntualFind.mockReturnValue(chainableCargoPuntual([{
      _id: 'cargo_001',
      etiquetaId: { nombre: 'Remera' },
      description: 'Remera adulto sin imagen',
      montoEsperadoSnapshot: 30000,
      montoPagadoSnapshot: 15000,
      estado: 'parcial',
    }]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toEqual([expect.objectContaining({
      cargoPuntualId: 'cargo_001',
      totalDeuda: 15000,
      estado: 'parcial',
      montoPagado: 15000,
    })]);
  });

  it('otrosCargos combina muro libre pendiente y varios cargos puntuales', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockAsistenciaFind.mockReturnValue(chainableAsistencia([
      { _id: 'asis_001', fecha: '2026-06-01T12:00:00Z', precioSugeridoSnapshot: 2000 },
    ]));
    mockCargoPuntualFind.mockReturnValue(chainableCargoPuntual([
      { _id: 'cargo_001', etiquetaId: { nombre: 'Inscripción' }, description: 'Inscripción 2026', montoEsperadoSnapshot: 5000 },
      { _id: 'cargo_002', etiquetaId: null, description: 'Cargo sin etiqueta', montoEsperadoSnapshot: 1000 },
    ]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toHaveLength(3);
    expect(result.otrosCargos[0].tipo).toBe('muro_libre');
    expect(result.otrosCargos[1]).toMatchObject({ tipo: 'cargo_puntual', cargoPuntualId: 'cargo_001', nombre: 'Inscripción' });
    expect(result.otrosCargos[2]).toMatchObject({ tipo: 'cargo_puntual', cargoPuntualId: 'cargo_002', nombre: 'Cargo puntual' });
  });

  it('appcarc-backend#176: otrosCargos incluye un evento pendiente en el que el socio es participante', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockEventoParticipanteFind.mockReturnValue(chainableEventoParticipante([{
      _id: 'participante_001',
      eventoId: { _id: 'evento_001', nombre: 'Trekking a Cerro Negro', descripcion: 'Salida del sábado' },
      nombre: 'Nahuel',
      apellido: 'Nicolai',
      montoEsperadoSnapshot: 20000,
      estado: 'pendiente',
    }]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toEqual([{
      tipo: 'evento',
      eventoId: 'evento_001',
      participanteId: 'participante_001',
      nombre: 'Trekking a Cerro Negro',
      descripcion: 'Salida del sábado',
      totalDeuda: 20000,
      estado: 'pendiente',
      montoPagado: 0,
    }]);
    expect(mockEventoParticipanteFind).toHaveBeenCalledWith(expect.objectContaining({
      clubId: 'CARC', socioId: 'socio_001', estado: { $in: ['pendiente', 'parcial'] }, active: true,
    }));
  });

  it('appcarc-backend#176: un evento parcial (seña pagada) muestra el SALDO restante', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockEventoParticipanteFind.mockReturnValue(chainableEventoParticipante([{
      _id: 'participante_001',
      eventoId: { _id: 'evento_001', nombre: 'Trekking a Cerro Negro' },
      nombre: 'Nahuel',
      apellido: 'Nicolai',
      montoEsperadoSnapshot: 20000,
      montoPagadoSnapshot: 8000,
      estado: 'parcial',
    }]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toEqual([expect.objectContaining({
      totalDeuda: 12000, estado: 'parcial', montoPagado: 8000,
    })]);
  });

  it('otrosCargos combina muro libre, cargos puntuales y eventos', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockAsistenciaFind.mockReturnValue(chainableAsistencia([
      { _id: 'asis_001', fecha: '2026-06-01T12:00:00Z', precioSugeridoSnapshot: 2000 },
    ]));
    mockCargoPuntualFind.mockReturnValue(chainableCargoPuntual([
      { _id: 'cargo_001', etiquetaId: { nombre: 'Inscripción' }, description: 'Inscripción 2026', montoEsperadoSnapshot: 5000 },
    ]));
    mockEventoParticipanteFind.mockReturnValue(chainableEventoParticipante([{
      _id: 'participante_001',
      eventoId: { _id: 'evento_001', nombre: 'Trekking a Cerro Negro' },
      nombre: 'Nahuel',
      montoEsperadoSnapshot: 20000,
      estado: 'pendiente',
    }]));

    const result = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(result.otrosCargos).toHaveLength(3);
    expect(result.otrosCargos[0].tipo).toBe('muro_libre');
    expect(result.otrosCargos[1].tipo).toBe('cargo_puntual');
    expect(result.otrosCargos[2].tipo).toBe('evento');
  });
});

// ---------------------------------------------------------------------------
// Tests de caracterización (appcarc-backend#263, docs/specs/cuotas-calcularDeuda.md).
// Fijan lo que el código hace HOY, con reloj fijo. Los que llevan código de
// duda (D1…D8) describen un comportamiento todavía no decidido: si alguno
// se rompe, que sea porque se resolvió esa duda a propósito.
// ---------------------------------------------------------------------------
describe('calcularDeuda — caracterización (#263), hoy = 2026-10-11', () => {
  const AHORA = new Date('2026-10-11T15:00:00.000Z');

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const conSuscripcion = (overrides, { pagadas = [], ultima = null, precio = { monto: 15000 } } = {}) => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion(overrides)]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(ultima));
    mockCuotaFind.mockReturnValue(chainableCuota(pagadas.map((periodo) => ({ periodo }))));
    mockPreciosFindOne.mockReturnValue(chainablePrecio(precio));
  };

  it('C2: desde 2026-07, pagó 07 y 08 → debe 09 y 10, total 30000', async () => {
    conSuscripcion({ fechaDesde: '2026-07' }, { pagadas: ['2026-07', '2026-08'], ultima: { periodo: '2026-08' } });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({
      periodos: ['2026-09', '2026-10'],
      mesesDeuda: 2,
      precioUnitario: 15000,
      totalDeuda: 30000,
      ultimoPeriodoPagado: '2026-08',
      periodoActual: '2026-10',
      fechaDesde: '2026-07',
      fechaHasta: null,
      planId: null,
    });
    expect(deuda).not.toHaveProperty('exento');
  });

  it('C3: sin precio configurado sigue contando los meses pero totalDeuda es null', async () => {
    conSuscripcion({ fechaDesde: '2026-09' }, { precio: null });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({ mesesDeuda: 2, precioUnitario: null, totalDeuda: null });
  });

  it('C3: precio en 0 no es "sin precio" → totalDeuda 0', async () => {
    conSuscripcion({ fechaDesde: '2026-09' }, { precio: { monto: 0 } });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({ mesesDeuda: 2, precioUnitario: 0, totalDeuda: 0 });
  });

  it('C5: cruza el cambio de año (desde 2025-11, hoy 2026-01) → 3 meses', async () => {
    vi.setSystemTime(new Date('2026-01-15T15:00:00.000Z'));
    conSuscripcion({ fechaDesde: '2025-11' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.periodos).toEqual(['2025-11', '2025-12', '2026-01']);
    expect(deuda.totalDeuda).toBe(45000);
  });

  it('C6 / D4: todos los meses adeudados se valúan al precio vigente HOY — comportamiento actual, pendiente de decidir', async () => {
    conSuscripcion({ fechaDesde: '2026-08' }, { precio: { monto: 18000 } });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.totalDeuda).toBe(3 * 18000);
    // Una sola búsqueda de precio, con la fecha de hoy (no una por período).
    expect(mockPreciosFindOne).toHaveBeenCalledTimes(1);
    expect(mockPreciosFindOne.mock.calls[0][0]).toMatchObject({
      clubId: 'CARC',
      etiquetaId: 'etq_social_id',
      active: true,
      vigenteDesde: { $lte: AHORA },
    });
  });

  it('C7: las cuotas pagadas se buscan por (socio, club, etiqueta), no por suscripcionId', async () => {
    conSuscripcion({ fechaDesde: '2026-08' }, { pagadas: ['2026-08'] });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.periodos).toEqual(['2026-09', '2026-10']);
    for (const [filtro] of mockCuotaFind.mock.calls) {
      expect(filtro).not.toHaveProperty('suscripcionId');
      expect(filtro).toMatchObject({ socioId: 'socio_001', clubId: 'CARC', etiquetaId: 'etq_social_id', estado: 'pagada', active: true });
    }
    // La consulta de pendientes se acota a los períodos candidatos del tramo.
    expect(mockCuotaFind).toHaveBeenCalledWith(expect.objectContaining({ periodo: { $in: ['2026-08', '2026-09', '2026-10'] } }));
  });

  it('C8: ultimoPeriodoPagado ignora pagos adelantados (periodo <= hoy, el más reciente)', async () => {
    conSuscripcion({ fechaDesde: '2026-08' }, { pagadas: ['2026-08'], ultima: { periodo: '2026-08' } });

    await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(mockCuotaFindOne).toHaveBeenCalledWith({
      socioId: 'socio_001', clubId: 'CARC', etiquetaId: 'etq_social_id', estado: 'pagada', active: true, periodo: { $lte: '2026-10' },
    });
    const sort = mockCuotaFindOne.mock.results[0].value.sort;
    expect(sort).toHaveBeenCalledWith({ periodo: -1 });
  });

  // D3 (resuelta, Nico 2026-10-11): se pueden adelantar cuotas, pero no se
  // cobran deudas futuras. Con fechaHasta futura la deuda llega como máximo
  // al mes en curso.
  it('D3: con fechaHasta futura la deuda llega solo hasta el mes en curso', async () => {
    conSuscripcion({ fechaDesde: '2026-09', fechaHasta: '2026-12' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({
      periodos: ['2026-09', '2026-10'],
      mesesDeuda: 2,
      totalDeuda: 30000,
      fechaHasta: '2026-12',
      periodoActual: '2026-10',
    });
    // Ni siquiera se consultan como candidatos los meses que no llegaron.
    expect(mockCuotaFind).toHaveBeenCalledWith(expect.objectContaining({ periodo: { $in: ['2026-09', '2026-10'] } }));
  });

  it('D3: un adelanto ya pagado no cambia la deuda ni el último período pagado, pero figura en periodosPagados', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-09', fechaHasta: '2026-12' })]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    // 1ª llamada: periodosPagados (toda la historia); 2ª: pagadas dentro de los candidatos.
    mockCuotaFind
      .mockReturnValueOnce(chainableCuota([{ periodo: '2026-12' }]))
      .mockReturnValueOnce(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({
      periodos: ['2026-09', '2026-10'],
      totalDeuda: 30000,
      ultimoPeriodoPagado: null,
      periodosPagados: ['2026-12'],
    });
  });

  it('D3: con fechaHasta igual al mes en curso cuenta ese mes', async () => {
    conSuscripcion({ fechaDesde: '2026-09', fechaHasta: '2026-10' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.periodos).toEqual(['2026-09', '2026-10']);
  });

  it('D7: dos tramos no exentos superpuestos de la misma etiqueta no cobran dos veces el mismo mes; lo cobra el que arrancó primero', async () => {
    // Mongo no los devuelve en orden: el que arrancó primero viene segundo.
    const nuevo = mockSuscripcion({ _id: 'sus_nuevo', fechaDesde: '2026-09' });
    const viejo = mockSuscripcion({ _id: 'sus_viejo', fechaDesde: '2026-08' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([nuevo, viejo]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(suscripciones.map((d) => d.suscripcionId)).toEqual(['sus_nuevo', 'sus_viejo']);
    expect(suscripciones[0]).toMatchObject({ periodos: [], mesesDeuda: 0, totalDeuda: 0, precioUnitario: 15000 });
    expect(suscripciones[1]).toMatchObject({ periodos: ['2026-08', '2026-09', '2026-10'], mesesDeuda: 3, totalDeuda: 45000 });
  });

  it('D7: con superposición parcial, cada tramo se queda con los meses que no cubre el anterior', async () => {
    const viejo = mockSuscripcion({ _id: 'sus_viejo', fechaDesde: '2026-07', fechaHasta: '2026-09' });
    const nuevo = mockSuscripcion({ _id: 'sus_nuevo', fechaDesde: '2026-09' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([viejo, nuevo]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([{ periodo: '2026-07' }]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(suscripciones[0]).toMatchObject({ periodos: ['2026-08', '2026-09'], mesesDeuda: 2, totalDeuda: 30000 });
    expect(suscripciones[1]).toMatchObject({ periodos: ['2026-10'], mesesDeuda: 1, totalDeuda: 15000 });
  });

  it('D7: sin precio, el tramo superpuesto sigue con totalDeuda null', async () => {
    const viejo = mockSuscripcion({ _id: 'sus_viejo', fechaDesde: '2026-09' });
    const nuevo = mockSuscripcion({ _id: 'sus_nuevo', fechaDesde: '2026-10' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([viejo, nuevo]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio(null));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(suscripciones[0]).toMatchObject({ periodos: ['2026-09', '2026-10'], mesesDeuda: 2, totalDeuda: null });
    expect(suscripciones[1]).toMatchObject({ periodos: [], mesesDeuda: 0, totalDeuda: null });
  });

  it('D7: tramos superpuestos de etiquetas distintas cobran cada uno sus meses', async () => {
    const social = mockSuscripcion({ _id: 'sus_social', fechaDesde: '2026-09' });
    const escuela = mockSuscripcion({ _id: 'sus_esc', fechaDesde: '2026-10', etiquetaId: { _id: 'etq_esc_id', nombre: 'Escuelita', unidad: 'mes', uso_sistema: null } });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([social, escuela]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(suscripciones[0].periodos).toEqual(['2026-09', '2026-10']);
    expect(suscripciones[1].periodos).toEqual(['2026-10']);
  });

  // Lo que importa del negocio (Nico, 2026-10-11): una suscripción abierta
  // (fechaHasta null) de escuelita o de cuota social genera deuda sola al
  // pasar de mes, sin reasignar el plan. El cambio de mes es el de Argentina.
  const etiquetaEscuelita = { _id: 'etq_escuelita_id', nombre: 'Escuelita', unidad: 'mes', uso_sistema: 'cuota_escuelita' };

  it.each([
    ['cuota social', mockEtiquetaSocial],
    ['escuelita', etiquetaEscuelita],
  ])('D3: una suscripción abierta de %s suma el mes nuevo sola al pasar la medianoche del 31/08 de Argentina', async (_, etiqueta) => {
    vi.setSystemTime(new Date('2026-08-31T23:30:00.000-03:00'));
    conSuscripcion({ etiquetaId: etiqueta, fechaDesde: '2026-07' }, { pagadas: ['2026-07'], ultima: { periodo: '2026-07' } });

    const [antes] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(antes).toMatchObject({ periodoActual: '2026-08', periodos: ['2026-08'], mesesDeuda: 1, totalDeuda: 15000, vigente: true });

    // Pasa la medianoche argentina; la suscripción no se toca.
    vi.setSystemTime(new Date('2026-09-01T00:30:00.000-03:00'));

    const [despues] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(despues).toMatchObject({
      periodoActual: '2026-09', periodos: ['2026-08', '2026-09'], mesesDeuda: 2, totalDeuda: 30000, fechaHasta: null, vigente: true,
    });
    expect(mockSuscripcionFind).toHaveBeenCalledTimes(2);
    expect(mockSuscripcionFind).toHaveBeenNthCalledWith(2, { socioId: 'socio_001', clubId: 'CARC', active: true });
  });

  it('D3: en una suscripción abierta, adelantar meses no descuenta deuda del mes en curso ni cierra la suscripción', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-09' })]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    // 1ª llamada: periodosPagados (toda la historia); 2ª: pagadas dentro de los candidatos.
    mockCuotaFind
      .mockReturnValueOnce(chainableCuota([{ periodo: '2026-11' }, { periodo: '2026-12' }]))
      .mockReturnValueOnce(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({
      periodos: ['2026-09', '2026-10'],
      mesesDeuda: 2,
      totalDeuda: 30000,
      ultimoPeriodoPagado: null,
      periodosPagados: ['2026-11', '2026-12'],
      fechaHasta: null,
      vigente: true,
    });
  });

  // vigente: el tramo sigue en curso (fechaHasta null o >= mes actual). Los
  // clientes lo usan en vez de inferir "cerrado" de fechaHasta && mesesDeuda === 0.
  it.each([
    ['sin fechaHasta', true, null],
    ['con fechaHasta futura', true, '2026-12'],
    ['con fechaHasta igual al mes actual', true, '2026-10'],
    ['con fechaHasta pasada', false, '2026-09'],
  ])('vigente %s → %s', async (_, vigente, fechaHasta) => {
    conSuscripcion({ fechaDesde: '2026-01', fechaHasta });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.vigente).toBe(vigente);
  });

  it('vigente también viene en un tramo exento y en uno que arranca a futuro', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([
      mockSuscripcion({ _id: 'exento_cerrado', fechaDesde: '2026-01', fechaHasta: '2026-09', exento: true }),
      mockSuscripcion({ _id: 'exento_abierto', fechaDesde: '2026-01', exento: true }),
      mockSuscripcion({ _id: 'futuro', fechaDesde: '2026-11', fechaHasta: '2026-12' }),
    ]));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(suscripciones.map((s) => [s.suscripcionId, s.vigente])).toEqual([
      ['exento_cerrado', false],
      ['exento_abierto', true],
      ['futuro', true],
    ]);
  });

  it('vigente usa el mes de Argentina: un tramo que termina en agosto sigue vigente el 31/08 a las 23:30 hs', async () => {
    vi.setSystemTime(new Date('2026-08-31T23:30:00.000-03:00'));
    conSuscripcion({ fechaDesde: '2026-08', fechaHasta: '2026-08' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.vigente).toBe(true);
  });

  it('fechaDesde igual al mes actual no es "a futuro": debe el mes actual', async () => {
    conSuscripcion({ fechaDesde: '2026-10' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({ periodos: ['2026-10'], mesesDeuda: 1, totalDeuda: 15000 });
  });

  it('C11 / D4: una suscripción a futuro busca el precio con la fecha de HOY, no la de fechaDesde — comportamiento actual, pendiente de decidir', async () => {
    conSuscripcion({ fechaDesde: '2026-11' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({ mesesDeuda: 0, periodos: [], totalDeuda: 0, precioUnitario: 15000, ultimoPeriodoPagado: null });
    expect(mockPreciosFindOne.mock.calls[0][0].vigenteDesde).toEqual({ $lte: AHORA });
    expect(mockCuotaFindOne).not.toHaveBeenCalled();
  });

  it('C10: exenta devuelve precioUnitario null y ultimoPeriodoPagado null aunque haya pagos', async () => {
    conSuscripcion({ fechaDesde: '2020-01', exento: true }, { pagadas: ['2026-01'] });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({ precioUnitario: null, ultimoPeriodoPagado: null, periodoActual: '2026-10', exento: true });
    expect(mockPreciosFindOne).not.toHaveBeenCalled();
  });

  // D1 (resuelta en #283): el mes actual es el de Argentina (UTC-3), sin
  // importar la zona horaria del proceso (el container corre en UTC). Para
  // ver fallar la versión vieja hay que correr con `TZ=UTC npx vitest run`.
  it('D1 (#283): el 31/08 a las 23:30 hs de Argentina (02:30 UTC del 01/09) el mes actual sigue siendo agosto', async () => {
    vi.setSystemTime(new Date('2026-08-31T23:30:00.000-03:00'));
    conSuscripcion({ fechaDesde: '2026-08' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.periodoActual).toBe('2026-08');
    expect(deuda.periodos).toEqual(['2026-08']);
    expect(mockCuotaFindOne).toHaveBeenCalledWith(expect.objectContaining({ periodo: { $lte: '2026-08' } }));
  });

  it('D1 (#283): el 01/09 a las 00:30 hs de Argentina ya es septiembre', async () => {
    vi.setSystemTime(new Date('2026-09-01T00:30:00.000-03:00'));
    conSuscripcion({ fechaDesde: '2026-08' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.periodoActual).toBe('2026-09');
    expect(deuda.periodos).toEqual(['2026-08', '2026-09']);
  });

  it('D1 (#283): una suscripción que arranca en septiembre todavía es "a futuro" el 31/08 a las 23:30 hs de Argentina', async () => {
    vi.setSystemTime(new Date('2026-08-31T23:30:00.000-03:00'));
    conSuscripcion({ fechaDesde: '2026-09' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda).toMatchObject({ periodoActual: '2026-08', mesesDeuda: 0, periodos: [], totalDeuda: 0 });
  });

  it('D8: periodosPagados se devuelve tal cual, con duplicados si hay dos cuotas del mismo período', async () => {
    conSuscripcion({ fechaDesde: '2026-10' }, { pagadas: ['2026-10', '2026-10'] });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.periodosPagados).toEqual(['2026-10', '2026-10']);
    expect(deuda.periodos).toEqual([]);
    expect(deuda.totalDeuda).toBe(0);
  });

  it('D8: el tope de seguridad de expandPeriodos deja pasar 601 períodos — comportamiento actual', async () => {
    conSuscripcion({ fechaDesde: '1900-01' });

    const [deuda] = (await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' })).suscripciones;

    expect(deuda.mesesDeuda).toBe(601);
    expect(deuda.periodos[0]).toBe('1900-01');
    expect(deuda.periodos[600]).toBe('1950-01');
  });

  it('C12: muro libre con una visita sin snapshot → cuenta la visita, monto null, suma como 0', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockAsistenciaFind.mockReturnValue(chainableAsistencia([
      { _id: 'a1', fecha: 'f1', precioSugeridoSnapshot: 2000 },
      { _id: 'a2', fecha: 'f2', precioSugeridoSnapshot: 2500 },
      { _id: 'a3', fecha: 'f3' },
    ]));

    const { otrosCargos } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(otrosCargos[0]).toMatchObject({ cantidadPendiente: 3, totalDeuda: 4500 });
    expect(otrosCargos[0].visitas[2]).toEqual({ asistenciaId: 'a3', fecha: 'f3', monto: null });
    const chain = mockAsistenciaFind.mock.results[0].value;
    expect(chain.sort).toHaveBeenCalledWith({ fecha: 1 });
  });

  it('D6: un cargo puntual pagado de más da totalDeuda negativo, sin piso en 0 — comportamiento actual, pendiente de decidir', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockCargoPuntualFind.mockReturnValue(chainableCargoPuntual([{
      _id: 'cargo_001', etiquetaId: { nombre: 'Remera' }, montoEsperadoSnapshot: 10000, montoPagadoSnapshot: 12000, estado: 'parcial',
    }]));

    const { otrosCargos } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(otrosCargos[0]).toMatchObject({ totalDeuda: -2000, montoPagado: 12000 });
  });

  it('D6: un evento pagado de más da totalDeuda negativo, sin piso en 0 — comportamiento actual, pendiente de decidir', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockEventoParticipanteFind.mockReturnValue(chainableEventoParticipante([{
      _id: 'p1', eventoId: { _id: 'e1', nombre: 'Viaje' }, montoEsperadoSnapshot: 20000, montoPagadoSnapshot: 25000, estado: 'parcial',
    }]));

    const { otrosCargos } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(otrosCargos[0].totalDeuda).toBe(-5000);
  });

  it('R7: evento sin populate → eventoId crudo, nombre "Evento" y descripcion vacía', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));
    mockEventoParticipanteFind.mockReturnValue(chainableEventoParticipante([{
      _id: 'p1', eventoId: 'evento_crudo', montoEsperadoSnapshot: 1000, estado: 'pendiente',
    }]));

    const { otrosCargos } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    expect(otrosCargos[0]).toMatchObject({ eventoId: 'evento_crudo', nombre: 'Evento', descripcion: '', totalDeuda: 1000, montoPagado: 0 });
  });

  it('R6/R7: cargos y eventos se ordenan por createdAt y populan solo los campos del nombre', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([]));

    await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });

    const cargoChain = mockCargoPuntualFind.mock.results[0].value;
    expect(cargoChain.populate).toHaveBeenCalledWith('etiquetaId', 'nombre');
    expect(cargoChain.sort).toHaveBeenCalledWith({ createdAt: 1 });
    const eventoChain = mockEventoParticipanteFind.mock.results[0].value;
    expect(eventoChain.populate).toHaveBeenCalledWith('eventoId', 'nombre descripcion');
    expect(eventoChain.sort).toHaveBeenCalledWith({ createdAt: 1 });
  });
});

// ---------------------------------------------------------------------------
// Precio de cada mes (#285): desglosePrecioHistorico y
// totalDeudaPrecioHistorico. totalDeuda no cambia (sigue al precio de hoy).
// ---------------------------------------------------------------------------
describe('calcularDeuda — precio de cada mes (#285), hoy = 2026-10-15', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-15T15:00:00.000Z'));
    mockCuotaFindOne.mockReturnValue(chainableCuota(null));
    mockCuotaFind.mockReturnValue(chainableCuota([]));
    mockPreciosFindOne.mockReturnValue(chainablePrecio({ monto: 15000 }));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Ejemplo del issue: $10.000 hasta junio, $12.000 desde julio, $15.000 desde septiembre.
  const PRECIOS_EJEMPLO = [
    { monto: 15000, vigenteDesde: new Date('2026-09-01T00:00:00.000Z'), vigenteHasta: null },
    { monto: 12000, vigenteDesde: new Date('2026-07-01T00:00:00.000Z'), vigenteHasta: new Date('2026-08-31T00:00:00.000Z') },
    { monto: 10000, vigenteDesde: new Date('2026-01-01T00:00:00.000Z'), vigenteHasta: new Date('2026-06-30T00:00:00.000Z') },
  ];

  it('ejemplo del issue: 8 meses dan $120.000 al precio de hoy y $94.000 al de cada mes', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-03' })]));
    mockPreciosFind.mockReturnValue(chainablePrecio(PRECIOS_EJEMPLO));

    const { suscripciones: [deuda] } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    expect(deuda.totalDeuda).toBe(120000);
    expect(deuda.totalDeudaPrecioHistorico).toBe(94000);
    expect(deuda.desglosePrecioHistorico.map((d) => d.monto)).toEqual([10000, 10000, 10000, 10000, 12000, 12000, 15000, 15000]);
    expect(deuda.desglosePrecioHistorico.map((d) => d.periodo)).toEqual(deuda.periodos);
  });

  it('con precios superpuestos gana el de vigenteDesde más reciente, vengan en el orden que vengan', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-10' })]));
    const viejo = { monto: 15000, vigenteDesde: new Date('2026-01-01'), vigenteHasta: null };
    const nuevo = { monto: 18000, vigenteDesde: new Date('2026-09-01'), vigenteHasta: null };

    for (const precios of [[viejo, nuevo], [nuevo, viejo]]) {
      mockPreciosFind.mockReturnValue(chainablePrecio(precios));
      const { suscripciones: [deuda] } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });
      expect(deuda.totalDeudaPrecioHistorico).toBe(18000);
    }
  });

  it('una sola consulta de precios por etiqueta, filtrada por club y acotada al rango de los meses adeudados', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-03' })]));
    mockPreciosFind.mockReturnValue(chainablePrecio(PRECIOS_EJEMPLO));

    await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    expect(mockPreciosFind).toHaveBeenCalledTimes(1);
    expect(mockPreciosFind).toHaveBeenCalledWith({
      clubId: 'CARC',
      etiquetaId: 'etq_social_id',
      active: true,
      // 1° de marzo y 1° de octubre a las 00:00 de Argentina.
      vigenteDesde: { $lte: new Date('2026-10-01T03:00:00.000Z') },
      $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: new Date('2026-03-01T03:00:00.000Z') } }],
    });
  });

  it('un mes sin precio queda con monto null y deja el total histórico en null; totalDeuda no cambia', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-08' })]));
    mockPreciosFind.mockReturnValue(chainablePrecio([PRECIOS_EJEMPLO[0]]));

    const { suscripciones: [deuda] } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    expect(deuda.desglosePrecioHistorico).toEqual([
      { periodo: '2026-08', monto: null },
      { periodo: '2026-09', monto: 15000 },
      { periodo: '2026-10', monto: 15000 },
    ]);
    expect(deuda.totalDeudaPrecioHistorico).toBeNull();
    expect(deuda.totalDeuda).toBe(45000);
  });

  it('un total histórico de $0 (precio cargado en 0) no se confunde con "sin precio"', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-10' })]));
    mockPreciosFind.mockReturnValue(chainablePrecio([{ monto: 0, vigenteDesde: new Date('2026-01-01'), vigenteHasta: null }]));

    const { suscripciones: [deuda] } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    expect(deuda.desglosePrecioHistorico).toEqual([{ periodo: '2026-10', monto: 0 }]);
    expect(deuda.totalDeudaPrecioHistorico).toBe(0);
  });

  it('al día, exenta o a futuro: desglose vacío y total histórico 0, sin consultar precios', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([
      mockSuscripcion({ _id: 'al_dia', fechaDesde: '2026-10' }),
      mockSuscripcion({ _id: 'exenta', exento: true, etiquetaId: { _id: 'etq_x', nombre: 'X' } }),
      mockSuscripcion({ _id: 'futura', fechaDesde: '2026-12', etiquetaId: { _id: 'etq_y', nombre: 'Y' } }),
    ]));
    mockCuotaFind.mockReturnValue(chainableCuota([{ periodo: '2026-10' }]));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    for (const deuda of suscripciones) {
      expect(deuda, deuda.suscripcionId).toMatchObject({ desglosePrecioHistorico: [], totalDeudaPrecioHistorico: 0, totalDeuda: 0 });
    }
    expect(mockPreciosFind).not.toHaveBeenCalled();
  });

  it('tramos superpuestos de la misma etiqueta: cada mes se valúa una vez y con una sola consulta', async () => {
    const viejo = mockSuscripcion({ _id: 'sus_viejo', fechaDesde: '2026-07', fechaHasta: '2026-09' });
    const nuevo = mockSuscripcion({ _id: 'sus_nuevo', fechaDesde: '2026-09' });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([nuevo, viejo]));
    mockPreciosFind.mockReturnValue(chainablePrecio(PRECIOS_EJEMPLO));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    const porId = Object.fromEntries(suscripciones.map((d) => [d.suscripcionId, d]));
    expect(porId.sus_viejo.desglosePrecioHistorico).toEqual([
      { periodo: '2026-07', monto: 12000 }, { periodo: '2026-08', monto: 12000 }, { periodo: '2026-09', monto: 15000 },
    ]);
    expect(porId.sus_viejo.totalDeudaPrecioHistorico).toBe(39000);
    expect(porId.sus_nuevo.desglosePrecioHistorico).toEqual([{ periodo: '2026-10', monto: 15000 }]);
    expect(porId.sus_nuevo.totalDeudaPrecioHistorico).toBe(15000);
    expect(mockPreciosFind).toHaveBeenCalledTimes(1);
  });

  it('etiquetas distintas: una consulta por etiqueta, cada una con sus precios', async () => {
    const social = mockSuscripcion({ _id: 'sus_social', fechaDesde: '2026-10' });
    const escuela = mockSuscripcion({ _id: 'sus_esc', fechaDesde: '2026-10', etiquetaId: { _id: 'etq_esc_id', nombre: 'Escuelita' } });
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([social, escuela]));
    mockPreciosFind.mockImplementation(({ etiquetaId }) => chainablePrecio([
      { monto: etiquetaId === 'etq_esc_id' ? 30000 : 15000, vigenteDesde: new Date('2026-01-01'), vigenteHasta: null },
    ]));

    const { suscripciones } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

    expect(suscripciones.map((d) => d.totalDeudaPrecioHistorico)).toEqual([15000, 30000]);
    expect(mockPreciosFind).toHaveBeenCalledTimes(2);
  });

  // Sin el parámetro (default de los llamadores en bucle: morosos, avisos,
  // export, advertencias) no se consulta Precios de más ni vienen los campos.
  it('sin incluirPrecioHistorico: no consulta Precios.find y no trae los dos campos', async () => {
    mockSuscripcionFind.mockReturnValue(chainableSuscripcion([mockSuscripcion({ fechaDesde: '2026-03' })]));
    mockPreciosFind.mockReturnValue(chainablePrecio(PRECIOS_EJEMPLO));

    for (const opciones of [{}, { incluirPrecioHistorico: false }]) {
      const { suscripciones: [deuda] } = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', ...opciones });

      expect(deuda).not.toHaveProperty('desglosePrecioHistorico');
      expect(deuda).not.toHaveProperty('totalDeudaPrecioHistorico');
      expect(deuda.totalDeuda).toBe(120000);
    }
    expect(mockPreciosFind).not.toHaveBeenCalled();
  });

  it('totalDeuda y el resto de la respuesta son idénticos con y sin el parámetro', async () => {
    const escenarios = [
      [mockSuscripcion({ fechaDesde: '2026-03' })],
      [mockSuscripcion({ fechaDesde: '2026-08' })],
      [mockSuscripcion({ _id: 'sus_viejo', fechaDesde: '2026-07', fechaHasta: '2026-09' }), mockSuscripcion({ _id: 'sus_nuevo', fechaDesde: '2026-09' })],
    ];
    mockPreciosFind.mockReturnValue(chainablePrecio(PRECIOS_EJEMPLO));

    for (const suscripciones of escenarios) {
      mockSuscripcionFind.mockReturnValue(chainableSuscripcion(suscripciones));
      const sin = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC' });
      const con = await calcularDeuda({ socioId: 'socio_001', clubId: 'CARC', incluirPrecioHistorico: true });

      const sacarHistorico = ({ desglosePrecioHistorico, totalDeudaPrecioHistorico, ...resto }) => resto;
      expect(con.suscripciones.map(sacarHistorico)).toEqual(sin.suscripciones);
      expect(con.otrosCargos).toEqual(sin.otrosCargos);
    }
  });
});
