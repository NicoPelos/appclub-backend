import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../cuotas/services/calcularDeuda.service.js', () => ({
  calcularDeuda: vi.fn(),
}));

import { getAdvertenciasHandler, agruparPorSocio } from '../../handlers/getAdvertencias.handler.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import Advertencia from '../../models/Advertencia.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import Escuelita from '../../../escuelita/models/Escuelita.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import { calcularDeuda } from '../../../cuotas/services/calcularDeuda.service.js';

const mockRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

const USER = { clubId: 'club1' };
const CLUB_ID = 'club1';
const SOCIO_ID = '507f1f77bcf86cd799439011';
const ETIQUETA_ESCUELITA_ID = '507f1f77bcf86cd799439022';

// Encadena find().populate().sort().lean() (o subsets) resolviendo `result`.
const chainable = (result) => {
  const q = {};
  q.populate = vi.fn(() => q);
  q.sort = vi.fn(() => q);
  q.select = vi.fn(() => q);
  q.lean = vi.fn().mockResolvedValue(result);
  return q;
};

const buildAsistencia = (overrides = {}) => ({
  _id: 'asist-1',
  clubId: CLUB_ID,
  tipo: 'escuelita',
  socioId: { _id: SOCIO_ID, telefono: '3511234567' },
  nombre: 'Juan',
  apellido: 'Pérez',
  fecha: new Date('2026-09-01T15:00:00.000Z'),
  advertencias: [{ codigo: 'CUOTA_IMPAGA', mensaje: 'Sin cuota de escuelita pagada para 2026-09' }],
  ...overrides,
});

// alumno.planId.etiquetaId — misma forma que devuelve Escuelita.find(...).populate('planId', 'etiquetaId').
const buildAlumno = (etiquetaId = ETIQUETA_ESCUELITA_ID) => ({
  socioId: SOCIO_ID,
  planId: { etiquetaId },
});

describe('getAdvertenciasHandler', () => {
  beforeEach(() => {
    Advertencia.find = vi.fn().mockReturnValue(chainable([]));
    Etiqueta.find = vi.fn().mockReturnValue(chainable([]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([]));
    Cuota.find = vi.fn().mockReturnValue(chainable([]));
    Suscripcion.find = vi.fn().mockReturnValue(chainable([]));
    calcularDeuda.mockResolvedValue({ suscripciones: [], otrosCargos: [] });
  });

  afterEach(() => vi.restoreAllMocks());

  it('should return 400 on invalid tipo', async () => {
    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: { tipo: 'invalido' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 on invalid codigo', async () => {
    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: { codigo: 'INVALIDO' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should exclude a CUOTA_IMPAGA advertencia when the Cuota was later paid (worklist se autolimpia) — etiqueta resuelta por el plan actual del socio', async () => {
    Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
    Cuota.find = vi.fn().mockReturnValue(chainable([
      { socioId: SOCIO_ID, etiquetaId: ETIQUETA_ESCUELITA_ID, periodo: '2026-09' },
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(0);
    expect(payload.total).toBe(0);
  });

  it('excluye una advertencia de cuota impaga cuando el socio tiene un tramo exento (No genera deuda) que cubre el período', async () => {
    Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
    Suscripcion.find = vi.fn().mockReturnValue(chainable([
      { socioId: SOCIO_ID, etiquetaId: ETIQUETA_ESCUELITA_ID, fechaDesde: '2026-08', fechaHasta: null },
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(0);
  });

  it('mantiene la advertencia si el tramo exento no cubre el período de la asistencia', async () => {
    Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
    Suscripcion.find = vi.fn().mockReturnValue(chainable([
      { socioId: SOCIO_ID, etiquetaId: ETIQUETA_ESCUELITA_ID, fechaDesde: '2026-10', fechaHasta: null },
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(1);
  });

  it('should keep a CUOTA_IMPAGA advertencia when the Cuota is still unpaid', async () => {
    Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
    Cuota.find = vi.fn().mockReturnValue(chainable([])); // nada pagado

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(1);
    expect(payload.advertencias[0].advertencias).toEqual([
      { codigo: 'CUOTA_IMPAGA', mensaje: 'Sin cuota de escuelita pagada para 2026-09' },
    ]);
  });

  it('BUG appcarc-backend#156: no marca falso "pagada" cuando el pago quedó contra OTRA etiqueta de escuelita (otro plan) que la del plan actual del socio', async () => {
    const OTRA_ETIQUETA_ID = '507f1f77bcf86cd799439099';
    Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno(ETIQUETA_ESCUELITA_ID)]));
    // Pagó, pero contra la etiqueta de otro plan (ej. quedó mal cargado, o
    // cambió de plan) — no debe contar como pagada la del plan actual.
    Cuota.find = vi.fn().mockReturnValue(chainable([
      { socioId: SOCIO_ID, etiquetaId: OTRA_ETIQUETA_ID, periodo: '2026-09' },
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(1);
  });

  it('should never re-check LIMITE_SEMANAL — se mantiene siempre aunque no haya Cuota que consultar', async () => {
    const asistencia = buildAsistencia({
      advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'Ya registró 2 clases esa semana (límite: 1)' }],
    });
    Asistencia.find = vi.fn().mockReturnValue(chainable([asistencia]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(1);
    // LIMITE_SEMANAL no es resoluble: ni Etiqueta, ni Escuelita, ni Cuota deberían consultarse.
    expect(Etiqueta.find).not.toHaveBeenCalled();
    expect(Escuelita.find).not.toHaveBeenCalled();
    expect(Cuota.find).not.toHaveBeenCalled();
  });

  it('should keep only the pending advertencia when one of two on the same asistencia got paid', async () => {
    const asistencia = buildAsistencia({
      advertencias: [
        { codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'Sin cuota social pagada para 2026-09' },
        { codigo: 'CUOTA_IMPAGA', mensaje: 'Sin cuota de escuelita pagada para 2026-09' },
      ],
    });
    const ETIQUETA_SOCIAL_ID = '507f1f77bcf86cd799439033';
    Asistencia.find = vi.fn().mockReturnValue(chainable([asistencia]));
    Etiqueta.find = vi.fn().mockReturnValue(chainable([
      { _id: ETIQUETA_SOCIAL_ID, uso_sistema: 'cuota_social' },
    ]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
    // Solo se pagó la cuota social, no la de escuelita.
    Cuota.find = vi.fn().mockReturnValue(chainable([
      { socioId: SOCIO_ID, etiquetaId: ETIQUETA_SOCIAL_ID, periodo: '2026-09' },
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(1);
    expect(payload.advertencias[0].advertencias).toEqual([
      { codigo: 'CUOTA_IMPAGA', mensaje: 'Sin cuota de escuelita pagada para 2026-09' },
    ]);
  });

  it('appcarc-backend#216: ?codigo= no trae los OTROS códigos vigentes del mismo check-in', async () => {
    // Las dos advertencias siguen vigentes (LIMITE_SEMANAL nunca se
    // rechequea, y no hay ninguna Cuota pagada que resuelva la social) — el
    // filtro de Mongo por codigo matchea el doc igual, así que sin filtrar
    // acá el array embebido se devolverían ambas aunque solo se pidió una.
    const asistenciaDosCodigos = buildAsistencia({
      advertencias: [
        { codigo: 'LIMITE_SEMANAL', mensaje: 'Ya registró 2 clases esa semana (límite: 1)' },
        { codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'Sin cuota social pagada para 2026-09' },
      ],
    });
    Asistencia.find = vi.fn().mockReturnValue(chainable([asistenciaDosCodigos]));
    Etiqueta.find = vi.fn().mockReturnValue(chainable([
      { _id: '507f1f77bcf86cd799439044', uso_sistema: 'cuota_social' },
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: { codigo: 'LIMITE_SEMANAL' } }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.advertencias).toHaveLength(1);
    expect(payload.advertencias[0].advertencias).toEqual([
      { codigo: 'LIMITE_SEMANAL', mensaje: 'Ya registró 2 clases esa semana (límite: 1)' },
    ]);
  });

  it('should not query Cuota/Etiqueta/Escuelita at all when no asistencia has a resolvable codigo', async () => {
    Asistencia.find = vi.fn().mockReturnValue(chainable([]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    expect(Etiqueta.find).not.toHaveBeenCalled();
    expect(Escuelita.find).not.toHaveBeenCalled();
    expect(Cuota.find).not.toHaveBeenCalled();
  });

  describe('waLink — manda TODA la deuda del socio, no solo lo que disparó la advertencia', () => {
    it('arma el mensaje con cada ítem de deuda y el total al final', async () => {
      Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
      Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
      Cuota.find = vi.fn().mockReturnValue(chainable([]));
      calcularDeuda.mockResolvedValue({
        suscripciones: [
          { etiqueta: { nombre: 'Cuota Social' }, mesesDeuda: 3, totalDeuda: 45000, exento: false },
          { etiqueta: { nombre: 'Escuelita' }, mesesDeuda: 0, totalDeuda: 0, exento: false }, // al día, no debe aparecer
        ],
        otrosCargos: [{ nombre: 'Muro Libre', totalDeuda: 8000 }],
      });

      const res = mockRes();
      await getAdvertenciasHandler({ user: USER, query: {} }, res);

      const [payload] = res.json.mock.calls[0];
      const wa = decodeURIComponent(payload.advertencias[0].waLink.split('text=')[1]);
      expect(wa).toContain('• Cuota Social: 3 meses — $45.000');
      expect(wa).toContain('• Muro Libre: $8.000');
      expect(wa).not.toContain('Escuelita:');
      expect(wa).toContain('Total: $53.000');
    });

    it('agrega aparte una advertencia que no es deuda (LIMITE_SEMANAL), sin perderla', async () => {
      const asistencia = buildAsistencia({
        advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'Ya registró 2 clases esa semana (límite: 1)' }],
      });
      Asistencia.find = vi.fn().mockReturnValue(chainable([asistencia]));
      calcularDeuda.mockResolvedValue({
        suscripciones: [{ etiqueta: { nombre: 'Cuota Social' }, mesesDeuda: 1, totalDeuda: 15000, exento: false }],
        otrosCargos: [],
      });

      const res = mockRes();
      await getAdvertenciasHandler({ user: USER, query: {} }, res);

      const [payload] = res.json.mock.calls[0];
      const wa = decodeURIComponent(payload.advertencias[0].waLink.split('text=')[1]);
      expect(wa).toContain('Total: $15.000');
      expect(wa).toContain('• Ya registró 2 clases esa semana (límite: 1)');
    });

    it('si no se pudo calcular la deuda, cae al mensaje puntual de la advertencia (no manda un WhatsApp vacío)', async () => {
      Asistencia.find = vi.fn().mockReturnValue(chainable([buildAsistencia()]));
      Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));
      calcularDeuda.mockRejectedValue(new Error('DB down'));

      const res = mockRes();
      await getAdvertenciasHandler({ user: USER, query: {} }, res);

      const [payload] = res.json.mock.calls[0];
      const wa = decodeURIComponent(payload.advertencias[0].waLink.split('text=')[1]);
      expect(wa).toContain('• Sin cuota de escuelita pagada para 2026-09');
    });

    it('no calcula deuda para filas sin teléfono (no hay a quién mandarle nada)', async () => {
      const asistencia = buildAsistencia({ socioId: { _id: SOCIO_ID, telefono: null } });
      Asistencia.find = vi.fn().mockReturnValue(chainable([asistencia]));
      Escuelita.find = vi.fn().mockReturnValue(chainable([buildAlumno()]));

      const res = mockRes();
      await getAdvertenciasHandler({ user: USER, query: {} }, res);

      const [payload] = res.json.mock.calls[0];
      expect(payload.advertencias[0].waLink).toBeNull();
      expect(calcularDeuda).not.toHaveBeenCalled();
    });
  });
});

describe('agruparPorSocio (appcarc-backend#210)', () => {
  beforeEach(() => {
    Advertencia.find = vi.fn().mockReturnValue(chainable([]));
    Etiqueta.find = vi.fn().mockReturnValue(chainable([]));
    Escuelita.find = vi.fn().mockReturnValue(chainable([]));
    Cuota.find = vi.fn().mockReturnValue(chainable([]));
    Suscripcion.find = vi.fn().mockReturnValue(chainable([]));
    calcularDeuda.mockResolvedValue({ suscripciones: [], otrosCargos: [] });
  });

  afterEach(() => vi.restoreAllMocks());

  const item = (over) => ({
    _id: 'a', tipo: 'muro_libre', socioId: SOCIO_ID, nombre: 'Ana', apellido: 'Gómez',
    fecha: new Date('2026-09-21T15:00:00.000Z'),
    advertencias: [{ codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'Sin cuota social pagada para 2026-09' }],
    ...over,
  });

  it('colapsa varios ingresos del mismo socio en una fila con la más reciente y cuenta los ingresos', () => {
    const res = agruparPorSocio([
      item({ _id: 'nueva', fecha: new Date('2026-09-21T15:00:00.000Z') }),
      item({ _id: 'media', fecha: new Date('2026-09-14T15:00:00.000Z'), advertencias: [{ codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'vieja' }] }),
      item({ _id: 'vieja', fecha: new Date('2026-09-11T15:00:00.000Z') }),
    ]);

    expect(res).toHaveLength(1);
    expect(res[0]._id).toBe('nueva');
    expect(res[0].ingresos).toBe(3);
    expect(res[0].advertencias).toEqual([
      { codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'Sin cuota social pagada para 2026-09' },
    ]);
  });

  it('une códigos distintos de ingresos distintos, quedándose con la más nueva de cada código', () => {
    const res = agruparPorSocio([
      item({ _id: 'nueva', advertencias: [{ codigo: 'PASE_MENSUAL_IMPAGO', mensaje: 'pase 09' }] }),
      item({ _id: 'vieja', advertencias: [
        { codigo: 'PASE_MENSUAL_IMPAGO', mensaje: 'pase 08' },
        { codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'social 08' },
      ] }),
    ]);

    expect(res).toHaveLength(1);
    expect(res[0].advertencias).toEqual([
      { codigo: 'PASE_MENSUAL_IMPAGO', mensaje: 'pase 09' },
      { codigo: 'CUOTA_SOCIAL_IMPAGA', mensaje: 'social 08' },
    ]);
  });

  it('LIMITE_SEMANAL no se pisa: se conserva cada una distinta y se deduplica solo la idéntica', () => {
    const res = agruparPorSocio([
      item({ _id: 'c', advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'semana 3' }] }),
      item({ _id: 'b', advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'semana 2' }] }),
      item({ _id: 'a', advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'semana 2' }] }),
    ]);

    expect(res[0].advertencias.map((a) => a.mensaje)).toEqual(['semana 3', 'semana 2']);
  });

  it('no mezcla socios distintos ni agrupa visitantes sin ficha', () => {
    const res = agruparPorSocio([
      item({ _id: '1', socioId: SOCIO_ID }),
      item({ _id: '2', socioId: '507f1f77bcf86cd799439099' }),
      item({ _id: '3', socioId: null }),
      item({ _id: '4', socioId: null }),
    ]);

    expect(res.map((r) => r._id)).toEqual(['1', '2', '3', '4']);
  });

  it('una advertencia de morosidad se une a la fila del socio pero no cuenta como ingreso', () => {
    const res = agruparPorSocio([
      item({ _id: 'checkin' }),
      item({ _id: 'moro', tipo: 'morosidad', fecha: new Date('2026-09-10T15:00:00.000Z'), advertencias: [{ codigo: 'MOROSIDAD_CUOTA_SOCIAL', mensaje: 'moroso' }] }),
    ]);

    expect(res).toHaveLength(1);
    expect(res[0].ingresos).toBe(1);
    expect(res[0].advertencias.map((a) => a.codigo)).toEqual(['CUOTA_SOCIAL_IMPAGA', 'MOROSIDAD_CUOTA_SOCIAL']);
  });

  it('el handler devuelve una sola fila por socio y total = cantidad de socios', async () => {
    Asistencia.find = vi.fn().mockReturnValue(chainable([
      buildAsistencia({ _id: 'n', tipo: 'muro_libre', fecha: new Date('2026-09-21T15:00:00.000Z'), advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'límite' }] }),
      buildAsistencia({ _id: 'v', tipo: 'muro_libre', fecha: new Date('2026-09-14T15:00:00.000Z'), advertencias: [{ codigo: 'LIMITE_SEMANAL', mensaje: 'límite' }] }),
    ]));

    const res = mockRes();
    await getAdvertenciasHandler({ user: USER, query: {} }, res);

    const [payload] = res.json.mock.calls[0];
    expect(payload.total).toBe(1);
    expect(payload.advertencias).toHaveLength(1);
    expect(payload.advertencias[0].ingresos).toBe(2);
  });
});
