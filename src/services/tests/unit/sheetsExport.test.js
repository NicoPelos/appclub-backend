import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('googleapis', () => ({
  google: {
    auth: { GoogleAuth: vi.fn().mockImplementation(() => ({})) },
    sheets: vi.fn().mockReturnValue({}),
  },
}));
vi.mock('../../../resources/socios/models/Socio.js', () => ({ default: { find: vi.fn(), countDocuments: vi.fn() } }));
vi.mock('../../../resources/cuotas/models/Cuota.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/suscripciones/models/Suscripcion.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/cobros/models/Cobro.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/escuelita/models/Escuelita.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/planes/models/Plan.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/movimientos/models/Movimiento.js', () => ({
  default: { find: vi.fn() },
  CATEGORIAS_MOVIMIENTO: {
    Ingreso: ['Viajes', 'Ventas / Reventa', 'Subsidios / Donaciones', 'Otros'],
    Egreso: ['Honorarios', 'Costos Fijos', 'Varios'],
  },
}));
vi.mock('../../../resources/horarios/models/Horarios.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/etiquetas/models/Etiqueta.js', () => ({ default: { find: vi.fn(), findOne: vi.fn() } }));
vi.mock('../../../resources/asistencias/models/Asistencia.js', () => ({ default: { find: vi.fn() } }));
vi.mock('../../../resources/advertencias/models/Advertencia.js', () => ({ default: { countDocuments: vi.fn() } }));
vi.mock('../../../resources/cuotas/services/calcularDeuda.service.js', () => ({ calcularDeuda: vi.fn() }));

import {
  buildCuotasSocialesRows, buildCuotasEscuelitaRows, buildMovimientosRows,
  buildDatosLargoRows, categoriaIngresoPorEtiqueta,
} from '../../sheetsExport.service.js';
import Socio from '../../../resources/socios/models/Socio.js';
import Cuota from '../../../resources/cuotas/models/Cuota.js';
import Suscripcion from '../../../resources/suscripciones/models/Suscripcion.js';
import Escuelita from '../../../resources/escuelita/models/Escuelita.js';
import Plan from '../../../resources/planes/models/Plan.js';
import Etiqueta from '../../../resources/etiquetas/models/Etiqueta.js';
import Movimiento from '../../../resources/movimientos/models/Movimiento.js';
import { calcularDeuda } from '../../../resources/cuotas/services/calcularDeuda.service.js';
import { periodoDeFecha } from '../../fechaArgentina.js';

const chain = (result) => {
  const obj = {};
  obj.sort = () => obj;
  obj.populate = () => obj;
  obj.lean = () => Promise.resolve(result);
  return obj;
};

// Los mismos 24 períodos "YYYY-MM" que genera generatePeriodos(24) en el service.
// Cuenta hacia atrás desde el mes en curso de Argentina, igual que el service.
const last24Periodos = () => {
  const [y, m] = periodoDeFecha(new Date()).split('-').map(Number);
  const periods = [];
  for (let i = 23; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    periods.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return periods;
};

// `etiquetaId` es el id que debe matchear con el que buildDeudaMap resuelve
// vía etiquetaIdPorSocio (appcarc-backend#156) — antes solo importaba
// uso_sistema, pero ahora el filtro es por _id de la etiqueta puntual del
// socio/alumno.
const deudaCon = (etiquetaId, usoSistema, mesesDeuda, periodos = []) => ({
  suscripciones: [{ etiqueta: { _id: etiquetaId, uso_sistema: usoSistema }, mesesDeuda, periodos }],
  otrosCargos: [],
});
const deudaVacia = () => ({ suscripciones: [], otrosCargos: [] });

beforeEach(() => vi.clearAllMocks());

describe('buildCuotasSocialesRows', () => {
  it('incluye la columna Estado (todos los estados juntos, para filtrar desde Sheets)', async () => {
    const periodos = last24Periodos();
    Etiqueta.find.mockReturnValue(chain([{ _id: 'etqSocial' }]));
    Socio.find.mockReturnValue(chain([
      { _id: 'socio1', socioNumber: '1', apellido: 'Pagador', nombre: 'A', dni: '1', estado: 'Activo' },
      { _id: 'socio2', socioNumber: '2', apellido: 'Baja', nombre: 'B', dni: '2', estado: 'Baja' },
    ]));
    Cuota.find.mockReturnValue(chain([
      { socioId: 'socio1', periodo: periodos.at(-1), estado: 'pagada' },
    ]));
    Suscripcion.find.mockReturnValue(chain([]));
    calcularDeuda.mockResolvedValue(deudaVacia());

    const { headers, rows } = await buildCuotasSocialesRows('CARC');

    expect(headers).toContain('Estado');
    expect(headers).not.toContain('Deuda estimada');
    expect(headers.at(-1)).toBe('Meses adeudados');
    expect(rows).toHaveLength(2); // Activo y Baja en la misma pestaña
    expect(rows[0]).toContain('Activo');
    expect(rows[1]).toContain('Baja');
  });

  it('"Meses adeudados" sale de calcularDeuda, no de contar pendiente', async () => {
    const periodos = last24Periodos();
    Etiqueta.find.mockReturnValue(chain([{ _id: 'etqSocial' }]));
    Socio.find.mockReturnValue(chain([
      { _id: 'socio1', socioNumber: '1', apellido: 'Deudor', nombre: 'A', dni: '1', estado: 'Activo' },
    ]));
    Cuota.find.mockReturnValue(chain([])); // sin Cuota 'pendiente' precargada
    Suscripcion.find.mockReturnValue(chain([]));
    calcularDeuda.mockResolvedValue(deudaCon('etqSocial', 'cuota_social', 2, [periodos.at(-1), periodos.at(-2)]));

    const { rows } = await buildCuotasSocialesRows('CARC');
    const INFO_COLS = 5; // N°Socio, Apellido, Nombre, DNI, Estado
    const cells = rows[0].slice(INFO_COLS, INFO_COLS + periodos.length);

    expect(rows[0].at(-1)).toBe(2);
    expect(cells.at(-1)).toBe('✗');
    expect(cells.at(-2)).toBe('✗');
  });

  it('marca con tilde verde los períodos cubiertos por una suscripción exenta', async () => {
    const periodos = last24Periodos();
    Etiqueta.find.mockReturnValue(chain([{ _id: 'etqSocial' }]));
    Socio.find.mockReturnValue(chain([
      { _id: 'socioExento', socioNumber: '2', apellido: 'Exento', nombre: 'B', dni: '2', estado: 'Activo' },
    ]));
    Cuota.find.mockReturnValue(chain([])); // exento no genera Cuota
    Suscripcion.find.mockReturnValue(chain([
      { socioId: 'socioExento', fechaDesde: periodos[0], fechaHasta: null, active: true, exento: true },
    ]));
    calcularDeuda.mockResolvedValue(deudaVacia());

    const { headers, rows } = await buildCuotasSocialesRows('CARC');
    const INFO_COLS = 5;
    const cells = rows[0].slice(INFO_COLS, INFO_COLS + periodos.length);

    expect(cells.every((c) => c === '✓')).toBe(true);
    expect(rows[0].at(-1)).toBe(0);
    expect(headers).not.toContain('Deuda estimada');
  });
});

describe('"Meses adeudados" de socios en Baja (appcarc-backend#307)', () => {
  const socio = (estado) => ({ _id: `socio${estado}`, socioNumber: '1', apellido: estado, nombre: 'A', dni: '1', estado });

  it('Cuotas Sociales: Baja muestra "—" y conserva los ✗; Activo y Adherente muestran el número', async () => {
    const periodos = last24Periodos();
    Etiqueta.find.mockReturnValue(chain([{ _id: 'etqSocial' }]));
    Socio.find.mockReturnValue(chain([socio('Activo'), socio('Adherente'), socio('Baja')]));
    Cuota.find.mockReturnValue(chain([]));
    Suscripcion.find.mockReturnValue(chain([]));
    calcularDeuda.mockResolvedValue(deudaCon('etqSocial', 'cuota_social', 4, [periodos.at(-1)]));

    const { rows } = await buildCuotasSocialesRows('CARC');
    const INFO_COLS = 5; // N°Socio, Apellido, Nombre, DNI, Estado
    const [activo, adherente, baja] = rows;

    expect(activo.at(-1)).toBe(4);
    expect(adherente.at(-1)).toBe(4);
    expect(baja.at(-1)).toBe('—');
    expect(baja[4]).toBe('Baja');
    expect(baja.slice(INFO_COLS, INFO_COLS + periodos.length).at(-1)).toBe('✗');
  });

  it('Cuotas Escuelita: Baja muestra "—" y conserva los ✗; Activo y Adherente muestran el número', async () => {
    const periodos = last24Periodos();
    Escuelita.find.mockReturnValue(chain(['Activo', 'Adherente', 'Baja'].map((estado) => ({
      socioId: socio(estado),
      planId: { nombre: 'Plan Escuelita', etiquetaId: 'etqEsc' },
    }))));
    Cuota.find.mockReturnValue(chain([]));
    Suscripcion.find.mockReturnValue(chain([]));
    calcularDeuda.mockResolvedValue(deudaCon('etqEsc', null, 2, [periodos.at(-1)]));

    const { rows } = await buildCuotasEscuelitaRows('CARC');
    const INFO_COLS = 6; // N°Socio, Apellido, Nombre, DNI, Categoría, Estado
    const [activo, adherente, baja] = rows;

    expect(activo.at(-1)).toBe(2);
    expect(adherente.at(-1)).toBe(2);
    expect(baja.at(-1)).toBe('—');
    expect(baja[5]).toBe('Baja');
    expect(baja.slice(INFO_COLS, INFO_COLS + periodos.length).at(-1)).toBe('✗');
  });
});

describe('buildCuotasEscuelitaRows', () => {
  it('incluye Categoría y Estado, con todos los alumnos juntos', async () => {
    const periodos = last24Periodos();
    Escuelita.find.mockReturnValue(chain([
      {
        socioId: { _id: 'alumno1', socioNumber: '3', apellido: 'Chico', nombre: 'C', dni: '3', estado: 'Adherente' },
        planId: { nombre: 'Plan Escuelita', etiquetaId: 'etqEscX2' },
      },
    ]));
    Cuota.find.mockReturnValue(chain([]));
    Suscripcion.find.mockReturnValue(chain([
      { socioId: 'alumno1', fechaDesde: periodos[0], fechaHasta: periodos.at(-1), active: true, exento: true },
    ]));
    calcularDeuda.mockResolvedValue(deudaVacia());

    const { headers, rows } = await buildCuotasEscuelitaRows('CARC');

    expect(headers).toContain('Categoría');
    expect(headers).toContain('Estado');
    expect(headers).not.toContain('Deuda estimada');
    expect(rows[0]).toContain('Adherente');
    const INFO_COLS = 6; // N°Socio, Apellido, Nombre, DNI, Categoría, Estado
    const cells = rows[0].slice(INFO_COLS, INFO_COLS + periodos.length);
    expect(cells.every((c) => c === '✓')).toBe(true);
  });

  it('BUG appcarc-backend#156: calcula la deuda con la etiqueta del PLAN del alumno, no con una única etiqueta global', async () => {
    const periodos = last24Periodos();
    Escuelita.find.mockReturnValue(chain([
      {
        socioId: { _id: 'alumno1', socioNumber: '9', apellido: 'X1', nombre: 'Alumno', dni: '9', estado: 'Activo' },
        planId: { nombre: 'Plan Escuelita x 1', etiquetaId: 'etqEscX1' }, // sin uso_sistema seteado
      },
    ]));
    Cuota.find.mockReturnValue(chain([]));
    Suscripcion.find.mockReturnValue(chain([]));
    calcularDeuda.mockResolvedValue(deudaCon('etqEscX1', null, 3, [periodos.at(-1)]));

    const { rows } = await buildCuotasEscuelitaRows('CARC');

    expect(rows[0].at(-1)).toBe(3);
  });

  it('devuelve headers sin Deuda estimada cuando no hay alumnos', async () => {
    Escuelita.find.mockReturnValue(chain([]));

    const { headers, rows } = await buildCuotasEscuelitaRows('CARC');

    expect(headers).not.toContain('Deuda estimada');
    expect(rows).toEqual([]);
  });
});

describe('buildMovimientosRows', () => {
  it('ordena cronológicamente y calcula el saldo acumulado', async () => {
    Movimiento.find.mockReturnValue(chain([
      { date: new Date('2026-06-05T15:00:00.000Z'), type: 'Ingreso', amount: 1000, concept: 'A', paymentMethod: 'Efectivo', responsable: 'x' },
      { date: new Date('2026-06-10T15:00:00.000Z'), type: 'Egreso', amount: 300, concept: 'B', paymentMethod: 'Efectivo', responsable: 'x' },
    ]));

    const { headers, rows } = await buildMovimientosRows('CARC');

    expect(headers).toEqual(['Fecha', 'Tipo', 'Concepto', 'Monto', 'Método', 'Responsable', 'Saldo', 'Ingresos del mes', 'Egresos del mes']);
    expect(rows[0][0]).toBe('05/06/2026');
    expect(rows[0][6]).toBe('$1.000'); // saldo tras el ingreso
    expect(rows[1][6]).toBe('$700'); // saldo tras el egreso (1000-300)
  });

  it('agrega una fila de cierre al pasar de un mes a otro, con el saldo y los totales del mes', async () => {
    Movimiento.find.mockReturnValue(chain([
      { date: new Date('2026-06-05T15:00:00.000Z'), type: 'Ingreso', amount: 1000, concept: 'A', paymentMethod: 'Efectivo', responsable: 'x' },
      { date: new Date('2026-07-01T15:00:00.000Z'), type: 'Egreso', amount: 400, concept: 'B', paymentMethod: 'Efectivo', responsable: 'x' },
    ]));

    const { rows, cierreRowIndices } = await buildMovimientosRows('CARC');

    expect(rows).toHaveLength(4); // 2 movimientos + cierre de junio + cierre de julio
    expect(cierreRowIndices).toEqual([1, 3]);
    expect(rows[1][0]).toBe('Cierre Junio 2026');
    expect(rows[1][6]).toBe('$1.000'); // saldo al cierre de junio
    expect(rows[1][7]).toBe('$1.000'); // ingresos de junio
    expect(rows[1][8]).toBe('$0'); // egresos de junio
    expect(rows[2][6]).toBe('$600'); // saldo tras el egreso de julio (1000-400)
    expect(rows[3][0]).toBe('Cierre Julio 2026');
    expect(rows[3][6]).toBe('$600'); // saldo al cierre de julio
  });

  it('un movimiento del último día del mes a las 23:30 ART sale con ese día y en ese mes (appcarc-backend#283)', async () => {
    Movimiento.find.mockReturnValue(chain([
      { date: new Date('2026-06-30T23:30:00-03:00'), type: 'Ingreso', amount: 1000, concept: 'A', paymentMethod: 'Efectivo', responsable: 'x' },
      { date: new Date('2026-07-01T00:30:00-03:00'), type: 'Ingreso', amount: 500, concept: 'B', paymentMethod: 'Efectivo', responsable: 'x' },
    ]));

    const { rows } = await buildMovimientosRows('CARC');

    expect(rows[0][0]).toBe('30/06/2026');
    expect(rows[1][0]).toBe('Cierre Junio 2026');
    expect(rows[1][7]).toBe('$1.000');
    expect(rows[2][0]).toBe('01/07/2026');
  });

  it('agrega el cierre del último mes aunque no haya un movimiento posterior', async () => {
    Movimiento.find.mockReturnValue(chain([
      { date: new Date('2026-06-05T15:00:00.000Z'), type: 'Ingreso', amount: 1000, concept: 'A', paymentMethod: 'Efectivo', responsable: 'x' },
    ]));

    const { rows, cierreRowIndices } = await buildMovimientosRows('CARC');

    expect(rows).toHaveLength(2);
    expect(cierreRowIndices).toEqual([1]);
    expect(rows[1][0]).toBe('Cierre Junio 2026');
  });
});

describe('buildDatosLargoRows', () => {
  const mockPopulateSortLean = (result) => ({ populate: () => ({ sort: () => ({ lean: () => Promise.resolve(result) }) }) });

  it('BUG appcarc-backend#156: incluye cuotas de planes de escuelita cuya etiqueta no tiene uso_sistema cuota_escuelita (ej. AvanzadosX1)', async () => {
    Etiqueta.findOne.mockReturnValue({ lean: () => Promise.resolve({ _id: 'etqSocial' }) });
    Plan.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([{ etiquetaId: 'etqEscX1' }, { etiquetaId: 'etqEscX2' }]) }) });
    Etiqueta.find.mockReturnValue(chain([
      { _id: 'etqSocial', nombre: 'Cuota Social' },
      { _id: 'etqEscX1', nombre: 'Cuota Escuelita x 1' },
    ]));
    Cuota.find.mockReturnValue(mockPopulateSortLean([
      {
        socioId: { socioNumber: '9', apellido: 'X1', nombre: 'Alumno', estado: 'Activo' },
        etiquetaId: 'etqEscX1',
        periodo: '2026-09',
        estado: 'pendiente',
      },
    ]));

    const { rows } = await buildDatosLargoRows('CARC');

    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Cuota Escuelita x 1');
  });

  it('devuelve filas vacías si no hay ninguna etiqueta social ni de escuelita', async () => {
    Etiqueta.findOne.mockReturnValue({ lean: () => Promise.resolve(null) });
    Plan.find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) });

    const { rows } = await buildDatosLargoRows('CARC');

    expect(rows).toEqual([]);
  });
});

describe('categoriaIngresoPorEtiqueta', () => {
  it('categoriza como Escuela Niños una etiqueta de escuelita sin uso_sistema seteado (ej. X1), por el nombre', () => {
    expect(categoriaIngresoPorEtiqueta({ nombre: 'Cuota Escuelita x 1', uso_sistema: null })).toBe('Escuela Niños');
  });

  it('categoriza por uso_sistema cuando está presente', () => {
    expect(categoriaIngresoPorEtiqueta({ nombre: 'Cuota Escuelita', uso_sistema: 'cuota_escuelita' })).toBe('Escuela Niños');
    expect(categoriaIngresoPorEtiqueta({ nombre: 'Cuota Social', uso_sistema: 'cuota_social' })).toBe('Cuota Social');
  });
});
