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

import Socio from '../../../socios/models/Socio.js';
import MercadoPagoConfig from '../../models/MercadoPagoConfig.js';
import { crearPreferenciaYGuardarIntent, getBackendPublicUrl } from '../../services/guardarPreferenciaMercadoPago.js';

const CLUB_ID = 'CARC';
const SOCIO_ID = 'socio-1';
const FALLBACK = 'https://app.appclub.net.ar';

const args = () => ({
  clubId: CLUB_ID,
  requestedByUserId: 'user-1',
  requestedByEmail: 'secretaria@carc.test',
  primarySocioId: SOCIO_ID,
  normalizedItems: [{ socioId: SOCIO_ID, periodos: ['2026-10'], amount: 5000 }],
  totalAmount: 5000,
  description: 'Cuota social',
});

// Body que se le mandó a MP en el POST /checkout/preferences.
const preferenceBodyEnviado = () => JSON.parse(fetch.mock.calls[0][1].body);

const urlsEsperadas = (base) => ({
  notification_url: `${base}/api/webhooks/mercadopago/${CLUB_ID}`,
  back_urls: {
    success: `${base}/pago/exito`,
    failure: `${base}/pago/error`,
    pending: `${base}/pago/pendiente`,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  MercadoPagoConfig.findOne = vi.fn().mockResolvedValue({ clubId: CLUB_ID, accessToken: 'TEST-token', active: true });
  Socio.find = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: SOCIO_ID, nombre: 'Ana', apellido: 'García' }]) });
  mockIntentSave.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({ id: 'pref-1', init_point: 'https://mp.test/checkout/pref-1' }),
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('crearPreferenciaYGuardarIntent — URLs públicas (BACKEND_PUBLIC_URL)', () => {
  it('usa BACKEND_PUBLIC_URL tal cual cuando está definida', async () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', 'https://app.appclub.net.ar');

    await crearPreferenciaYGuardarIntent(args());

    expect(preferenceBodyEnviado()).toMatchObject(urlsEsperadas('https://app.appclub.net.ar'));
  });

  it('saca la barra final para no armar URLs con //', async () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', 'https://app.appclub.net.ar/');

    await crearPreferenciaYGuardarIntent(args());

    const body = preferenceBodyEnviado();
    expect(body).toMatchObject(urlsEsperadas('https://app.appclub.net.ar'));
    expect(body.notification_url).not.toContain('.ar//');
  });

  it('cae al host de Tailscale si la variable no está definida', async () => {
    // stubEnv(undefined) deja el string "undefined" en esta versión de
    // vitest; se stubbea para que unstubAllEnvs restaure el valor y se borra.
    vi.stubEnv('BACKEND_PUBLIC_URL', '');
    delete process.env.BACKEND_PUBLIC_URL;

    await crearPreferenciaYGuardarIntent(args());

    expect(preferenceBodyEnviado()).toMatchObject(urlsEsperadas(FALLBACK));
  });

  it('trata una variable vacía como no definida', async () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', '');

    await crearPreferenciaYGuardarIntent(args());

    expect(preferenceBodyEnviado()).toMatchObject(urlsEsperadas(FALLBACK));
  });
});

describe('getBackendPublicUrl', () => {
  it('saca varias barras finales y espacios', () => {
    vi.stubEnv('BACKEND_PUBLIC_URL', ' https://app.appclub.net.ar// ');
    expect(getBackendPublicUrl()).toBe('https://app.appclub.net.ar');
  });
});
