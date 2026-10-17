import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockIntentSave } = vi.hoisted(() => ({ mockIntentSave: vi.fn() }));

vi.mock('../../../socios/models/Socio.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../models/MercadoPagoConfig.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../models/PagoOnlineIntent.js', () => {
  const PagoOnlineIntentMock = vi.fn().mockImplementation((data) => ({ ...data, save: mockIntentSave }));
  return { default: PagoOnlineIntentMock };
});
vi.mock('../../../suscripciones/models/Suscripcion.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../cuotas/models/Cuota.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../cargosPuntuales/models/CargoPuntual.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../asistencias/models/Asistencia.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../etiquetas/models/Etiqueta.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../cuotas/services/findPrecioVigente.service.js', () => ({
  findPrecioVigente: vi.fn(),
}));
vi.mock('../../../usuarios/models/User.js', () => ({
  default: { findById: vi.fn() },
}));
vi.mock('../../../vinculos/models/VinculoFamiliar.js', () => ({
  default: { find: vi.fn() },
}));
vi.mock('../../../eventos/models/Evento.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../../eventos/models/EventoParticipante.js', () => ({
  default: { findOne: vi.fn() },
}));
vi.mock('../../services/avisarPrecioNoVigentePagoOnline.service.js', () => ({
  avisarPrecioNoVigentePagoOnline: vi.fn().mockResolvedValue({ avisado: true }),
}));

import Socio from '../../../socios/models/Socio.js';
import MercadoPagoConfig from '../../models/MercadoPagoConfig.js';
import PagoOnlineIntent from '../../models/PagoOnlineIntent.js';
import Suscripcion from '../../../suscripciones/models/Suscripcion.js';
import Cuota from '../../../cuotas/models/Cuota.js';
import CargoPuntual from '../../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../../asistencias/models/Asistencia.js';
import Etiqueta from '../../../etiquetas/models/Etiqueta.js';
import User from '../../../usuarios/models/User.js';
import VinculoFamiliar from '../../../vinculos/models/VinculoFamiliar.js';
import Evento from '../../../eventos/models/Evento.js';
import EventoParticipante from '../../../eventos/models/EventoParticipante.js';
import { findPrecioVigente } from '../../../cuotas/services/findPrecioVigente.service.js';
import { avisarPrecioNoVigentePagoOnline } from '../../services/avisarPrecioNoVigentePagoOnline.service.js';
import { crearPreferenciaCobroPropioMercadoPago, BusinessError } from '../../services/crearPreferenciaCobroPropioMercadoPago.service.js';

const CLUB_ID = 'CARC';
const USER_ID = 'user-1';
const SOCIO_ID = 'socio-1'; // propio del usuario
const HIJO_ID = 'socio-hijo'; // vinculado
const SUSCRIPCION_ID = 'sus-1';

const baseArgs = () => ({
  clubId: CLUB_ID,
  requestedByUserId: USER_ID,
  requestedByEmail: 'tutor@carc.test',
  items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07', '2026-08'] }],
});

const stubMpFetch = (body, ok = true, status = 200) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  }));
};

beforeEach(() => {
  vi.clearAllMocks();
  MercadoPagoConfig.findOne = vi.fn().mockResolvedValue({ clubId: CLUB_ID, accessToken: 'TEST-token', active: true });
  Socio.find = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', correoElectronico: 'ana@test.com' }]) });
  User.findById = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ socioId: SOCIO_ID }) }) });
  VinculoFamiliar.find = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ hijoSocioId: HIJO_ID }]) }) });
  Suscripcion.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: SUSCRIPCION_ID, socioId: SOCIO_ID, clubId: CLUB_ID, etiquetaId: 'etq-1', active: true }) });
  Cuota.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  CargoPuntual.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  Asistencia.find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });
  Etiqueta.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'etq-1', nombre: 'Cuota Social' }) });
  EventoParticipante.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  Evento.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
  findPrecioVigente.mockResolvedValue({ monto: 7500 });
  mockIntentSave.mockResolvedValue(undefined);
  stubMpFetch({ id: 'pref-1', init_point: 'https://mp.test/checkout/pref-1' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('crearPreferenciaCobroPropioMercadoPago', () => {
  it('genera la preferencia resolviendo el precio vigente en el servidor', async () => {
    const result = await crearPreferenciaCobroPropioMercadoPago(baseArgs());

    expect(result).toEqual({ initPoint: 'https://mp.test/checkout/pref-1', preferenceId: 'pref-1', intentId: expect.any(String) });
    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({
      clubId: CLUB_ID,
      socioId: SOCIO_ID,
      totalAmount: 15000, // 2 períodos × 7500
      preferenceId: 'pref-1',
    }));
    expect(mockIntentSave).toHaveBeenCalled();
  });

  it('ignora cualquier "amount" que venga en el body y usa el precio vigente igual', async () => {
    const args = baseArgs();
    args.items = [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'], amount: 1 }];

    await crearPreferenciaCobroPropioMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 7500 }));
  });

  it('permite pagar en un mismo link ítems del propio usuario y de un hijo vinculado', async () => {
    CargoPuntual.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'cargo-1', estado: 'pendiente', montoEsperadoSnapshot: 3000, description: 'Salida' }) });
    Socio.find = vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { _id: SOCIO_ID, nombre: 'Ana', apellido: 'García', correoElectronico: 'ana@test.com' },
        { _id: HIJO_ID, nombre: 'Tomás', apellido: 'García', correoElectronico: null },
      ]),
    });
    const args = {
      ...baseArgs(),
      items: [
        { socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'] }, // 7500
        { socioId: HIJO_ID, cargoPuntualId: 'cargo-1' }, // 3000
      ],
    };

    await crearPreferenciaCobroPropioMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({
      socioId: SOCIO_ID, // primario: el propio del usuario
      totalAmount: 10500,
      items: expect.arrayContaining([
        expect.objectContaining({ socioId: SOCIO_ID }),
        expect.objectContaining({ socioId: HIJO_ID }),
      ]),
    }));
  });

  it('rechaza un item cuyo socioId no es un perfil accesible del usuario (ni propio ni vinculado)', async () => {
    const args = { ...baseArgs(), items: [{ socioId: 'socio-ajeno', suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'] }] };

    await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ status: 403 });
  });

  it('resuelve el monto de un cargo puntual desde su snapshot', async () => {
    CargoPuntual.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'cargo-1', estado: 'pendiente', montoEsperadoSnapshot: 3000, description: 'Salida' }) });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, cargoPuntualId: 'cargo-1' }] };

    await crearPreferenciaCobroPropioMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 3000 }));
  });

  it('rechaza un cargo puntual que ya está pagado', async () => {
    CargoPuntual.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'cargo-1', estado: 'pagada', montoEsperadoSnapshot: 3000, description: 'Salida' }) });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, cargoPuntualId: 'cargo-1' }] };

    await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ status: 409 });
  });

  it('appcarc-backend#168: un cargo parcial (con una seña ya pagada) cobra el SALDO restante, no el total', async () => {
    CargoPuntual.findOne = vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({ _id: 'cargo-1', estado: 'parcial', montoEsperadoSnapshot: 30000, montoPagadoSnapshot: 15000, description: 'Remera' }),
    });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, cargoPuntualId: 'cargo-1' }] };

    await crearPreferenciaCobroPropioMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 15000 }));
  });

  it('suma las visitas pendientes de Muro Libre desde su precioSugeridoSnapshot', async () => {
    Asistencia.find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: 'a1', precioSugeridoSnapshot: 2000 }, { _id: 'a2', precioSugeridoSnapshot: 2500 }]) }) });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, muroLibrePendiente: true }] };

    await crearPreferenciaCobroPropioMercadoPago(args);

    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 4500 }));
  });

  it('#317: guarda un item por visita con su id y su precio, no el promedio', async () => {
    Asistencia.find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: 'a1', precioSugeridoSnapshot: 2000 }, { _id: 'a2', precioSugeridoSnapshot: 2500 }]) }) });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, muroLibrePendiente: true }] };

    await crearPreferenciaCobroPropioMercadoPago(args);

    const { items } = PagoOnlineIntent.mock.calls[0][0];
    expect(items).toEqual([
      expect.objectContaining({ socioId: SOCIO_ID, muroLibrePendiente: true, asistenciaIds: ['a1'], amount: 2000 }),
      expect.objectContaining({ socioId: SOCIO_ID, muroLibrePendiente: true, asistenciaIds: ['a2'], amount: 2500 }),
    ]);
    expect(items.every((i) => i.cantidad === undefined)).toBe(true);
  });

  describe('Muro Libre con visitas registradas sin precio (#317)', () => {
    const FECHA_SIN_PRECIO = new Date('2026-12-03T15:00:00.000Z');
    const pendientes = (visitas) => {
      Asistencia.find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(visitas) }) });
    };
    const args = () => ({ ...baseArgs(), items: [{ socioId: SOCIO_ID, muroLibrePendiente: true }] });

    beforeEach(() => {
      Etiqueta.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ _id: 'etq-muro', nombre: 'Muro Libre diario socio' }) });
    });

    it('una visita sin precio suma el precio vigente en su fecha, no 0', async () => {
      pendientes([
        { fecha: new Date('2026-11-20T15:00:00.000Z'), esSocio: true, precioSugeridoSnapshot: 5000 },
        { fecha: FECHA_SIN_PRECIO, esSocio: true, precioSugeridoSnapshot: null },
      ]);
      findPrecioVigente.mockResolvedValue({ monto: 6000 });

      await crearPreferenciaCobroPropioMercadoPago(args());

      expect(Etiqueta.findOne).toHaveBeenCalledWith({ clubId: CLUB_ID, uso_sistema: 'muro_libre_diario_socio', active: true });
      expect(findPrecioVigente).toHaveBeenCalledTimes(1);
      expect(findPrecioVigente).toHaveBeenCalledWith({ clubId: CLUB_ID, etiquetaId: 'etq-muro', date: FECHA_SIN_PRECIO });
      expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 11000 }));
    });

    it('si tampoco hay precio vigente en la fecha de la visita, rechaza con PRECIO_NO_VIGENTE y avisa al staff', async () => {
      pendientes([
        { fecha: new Date('2026-11-20T15:00:00.000Z'), esSocio: true, precioSugeridoSnapshot: 5000 },
        { fecha: FECHA_SIN_PRECIO, esSocio: true, precioSugeridoSnapshot: null },
      ]);
      findPrecioVigente.mockResolvedValue(null);

      await expect(crearPreferenciaCobroPropioMercadoPago(args())).rejects.toMatchObject({
        status: 400,
        message: 'Todavía no está cargado el precio de «Muro Libre diario socio» para diciembre 2026, así que por ahora no se puede pagar online. Le avisamos al club para que lo cargue.',
        data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: 'etq-muro', periodo: '2026-12' },
      });
      expect(avisarPrecioNoVigentePagoOnline).toHaveBeenCalledWith(expect.objectContaining({ socioId: SOCIO_ID, periodo: '2026-12' }));
      expect(PagoOnlineIntent).not.toHaveBeenCalled();
    });

    it('si todas tienen precio guardado no busca nada más', async () => {
      pendientes([{ fecha: FECHA_SIN_PRECIO, esSocio: true, precioSugeridoSnapshot: 5000 }]);

      await crearPreferenciaCobroPropioMercadoPago(args());

      expect(Etiqueta.findOne).not.toHaveBeenCalled();
      expect(findPrecioVigente).not.toHaveBeenCalled();
    });
  });

  it('rechaza si un período ya está pagado', async () => {
    Cuota.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue({ periodo: '2026-07', estado: 'pagada' }) });

    await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toMatchObject({ status: 409 });
  });

  it('rechaza si la suscripción no le pertenece al socio indicado', async () => {
    Suscripcion.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });

    await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toMatchObject({ status: 404 });
  });

  describe('sin precio vigente (#317)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-12-02T10:00:00.000-03:00'));
      findPrecioVigente.mockResolvedValue(null);
    });
    afterEach(() => vi.useRealTimers());

    it('le explica al socio qué falta, sin mandarlo a la pantalla de precios, y devuelve PRECIO_NO_VIGENTE', async () => {
      await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toMatchObject({
        status: 400,
        message: 'Todavía no está cargado el precio de «Cuota Social» para diciembre 2026, así que por ahora no se puede pagar online. Le avisamos al club para que lo cargue.',
        data: { code: 'PRECIO_NO_VIGENTE', etiquetaId: 'etq-1', etiquetaNombre: 'Cuota Social', periodo: '2026-12' },
      });
      expect(PagoOnlineIntent).not.toHaveBeenCalled();
    });

    it('avisa al staff con la etiqueta, el socio y el mes', async () => {
      await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toBeInstanceOf(BusinessError);
      expect(avisarPrecioNoVigentePagoOnline).toHaveBeenCalledWith({
        clubId: CLUB_ID, etiqueta: { _id: 'etq-1', nombre: 'Cuota Social' }, socioId: SOCIO_ID, periodo: '2026-12',
      });
    });

    it('si el aviso al staff falla, el socio igual recibe el mensaje claro', async () => {
      avisarPrecioNoVigentePagoOnline.mockRejectedValueOnce(new Error('Mongo caído'));
      await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toMatchObject({
        data: expect.objectContaining({ code: 'PRECIO_NO_VIGENTE' }),
      });
    });
  });

  it('rechaza si el usuario no tiene ningún perfil accesible', async () => {
    User.findById = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) });
    VinculoFamiliar.find = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }) });

    await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toMatchObject({ status: 401 });
  });

  it('rechaza si items está vacío', async () => {
    const args = { ...baseArgs(), items: [] };
    await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('ítem') });
  });

  it('muro libre con cantidad paga solo las visitas más viejas pedidas (#201)', async () => {
    Asistencia.find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ precioSugeridoSnapshot: 2000 }, { precioSugeridoSnapshot: 2000 }, { precioSugeridoSnapshot: 2000 }]) }) });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, muroLibrePendiente: true, cantidad: 1 }] };
    await crearPreferenciaCobroPropioMercadoPago(args);
    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 2000 }));
  });

  it('muro libre rechaza pedir más visitas que las pendientes (#201)', async () => {
    Asistencia.find = vi.fn().mockReturnValue({ sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ precioSugeridoSnapshot: 2000 }]) }) });
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, muroLibrePendiente: true, cantidad: 3 }] };
    await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('entre 1 y 1 visitas') });
  });

  it('rechaza si un item no indica ni suscripcionId, ni cargoPuntualId, ni muroLibrePendiente', async () => {
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID }] };
    await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('suscripcionId, cargoPuntualId, muroLibrePendiente o eventoParticipanteId') });
  });

  it('rechaza items duplicados', async () => {
    const args = {
      ...baseArgs(),
      items: [
        { socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'] },
        { socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-08'] },
      ],
    };

    await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ message: expect.stringContaining('duplicado') });
  });

  it('rechaza si el club no tiene Mercado Pago configurado', async () => {
    MercadoPagoConfig.findOne.mockResolvedValue(null);

    await expect(crearPreferenciaCobroPropioMercadoPago(baseArgs())).rejects.toBeInstanceOf(BusinessError);
  });

  it('appcarc-backend#258: deduplica períodos repetidos dentro de un mismo item', async () => {
    const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07', '2026-07'] }] };

    await crearPreferenciaCobroPropioMercadoPago(args);

    // Sin el dedup esto sería 15000 (7500 × 2 "períodos")
    expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 7500 }));
  });

  it('appcarc-backend#261: busca la etiqueta de la suscripción filtrando por clubId', async () => {
    await crearPreferenciaCobroPropioMercadoPago(baseArgs());

    expect(Etiqueta.findOne).toHaveBeenCalledWith({ _id: 'etq-1', clubId: CLUB_ID });
  });

  describe('autoservicio de pago de eventos', () => {
    const PARTICIPANTE_ID = 'participante-1';
    const EVENTO_ID = 'evento-1';

    const mockParticipante = (overrides = {}) => {
      EventoParticipante.findOne = vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          _id: PARTICIPANTE_ID, eventoId: EVENTO_ID, socioId: SOCIO_ID,
          montoEsperadoSnapshot: 20000, montoPagadoSnapshot: 0, estado: 'pendiente', active: true,
          ...overrides,
        }),
      });
    };
    const mockEvento = (overrides = {}) => {
      Evento.findOne = vi.fn().mockReturnValue({
        lean: vi.fn().mockResolvedValue({ _id: EVENTO_ID, nombre: 'Asado Villa Alpina', estado: 'abierto', active: true, ...overrides }),
      });
    };

    it('resuelve el monto desde el saldo pendiente del participante', async () => {
      mockParticipante();
      mockEvento();
      const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, eventoParticipanteId: PARTICIPANTE_ID }] };

      await crearPreferenciaCobroPropioMercadoPago(args);

      expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({
        totalAmount: 20000,
        items: [expect.objectContaining({ eventoId: EVENTO_ID, eventoParticipanteId: PARTICIPANTE_ID, amount: 20000, description: 'Asado Villa Alpina' })],
      }));
    });

    it('con una seña ya pagada (estado parcial), cobra el SALDO restante', async () => {
      mockParticipante({ estado: 'parcial', montoPagadoSnapshot: 8000 });
      mockEvento();
      const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, eventoParticipanteId: PARTICIPANTE_ID }] };

      await crearPreferenciaCobroPropioMercadoPago(args);

      expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 12000 }));
    });

    it('rechaza si el participante no existe o no es accesible', async () => {
      EventoParticipante.findOne = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
      const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, eventoParticipanteId: PARTICIPANTE_ID }] };

      await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ status: 404 });
    });

    it('rechaza si el participante ya está pagado', async () => {
      mockParticipante({ estado: 'pagada' });
      mockEvento();
      const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, eventoParticipanteId: PARTICIPANTE_ID }] };

      await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ status: 409 });
    });

    it('rechaza si el evento está cerrado', async () => {
      mockParticipante();
      mockEvento({ estado: 'cerrado' });
      const args = { ...baseArgs(), items: [{ socioId: SOCIO_ID, eventoParticipanteId: PARTICIPANTE_ID }] };

      await expect(crearPreferenciaCobroPropioMercadoPago(args)).rejects.toMatchObject({ status: 409 });
    });

    it('permite combinar en un mismo link una cuota y un evento', async () => {
      mockParticipante();
      mockEvento();
      const args = {
        ...baseArgs(),
        items: [
          { socioId: SOCIO_ID, suscripcionId: SUSCRIPCION_ID, periodos: ['2026-07'] }, // 7500
          { socioId: SOCIO_ID, eventoParticipanteId: PARTICIPANTE_ID }, // 20000
        ],
      };

      await crearPreferenciaCobroPropioMercadoPago(args);

      expect(PagoOnlineIntent).toHaveBeenCalledWith(expect.objectContaining({ totalAmount: 27500 }));
    });
  });
});
