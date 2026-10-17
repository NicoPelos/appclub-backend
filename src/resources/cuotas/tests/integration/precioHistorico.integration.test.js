import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../../../index.js';
import Cuota from '../../models/Cuota.js';
import Cobro from '../../../cobros/models/Cobro.js';
import AuditLog from '../../../audit/models/AuditLog.js';
import * as pushNotificationService from '../../../../services/pushNotification.service.js';
import { PERMISOS } from '../../../../constants/permisos.js';
import { invalidarClub } from '../../../../services/permisosCache.js';
import {
  CLUB_ID, createAdminUser, createSocio, createEtiqueta, createPrecio, createSuscripcion, getOrCreateRol,
} from '../../../../testUtils/integrationHelpers.js';

// Cobrar la deuda a precio de cada mes (appcarc-backend#285). Se fija "hoy"
// en octubre de 2026 (solo Date: los timers del driver de Mongo siguen reales)
// para que el ejemplo del issue dé exactamente lo mismo que en el issue.
const D = (iso) => new Date(iso);
const MOTIVO = 'Acuerdo de regularización con la comisión.';

let sendPushNotification;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: D('2026-10-15T15:00:00.000Z'), shouldAdvanceTime: true });
  sendPushNotification = vi.spyOn(pushNotificationService, 'sendPushNotification').mockResolvedValue({ sent: 1 });
});
afterEach(() => {
  vi.useRealTimers();
  sendPushNotification.mockRestore();
});

// Usuario con un rol del club que tiene exactamente estos permisos (no
// superadmin, que pasa cualquier authorize). Los permisos se cachean por club
// en el proceso: hay que invalidar, igual que hace PUT /api/roles/:id.
const crearUsuarioConPermisos = async (nombreRol, permisos) => {
  const rol = await getOrCreateRol({ clubId: CLUB_ID, nombre: nombreRol });
  rol.permisos = permisos;
  await rol.save();
  invalidarClub(CLUB_ID);
  return createAdminUser({ roles: [nombreRol] });
};

const secretaria = () => crearUsuarioConPermisos('secretaria', [
  PERMISOS.COBROS_READ, PERMISOS.COBROS_WRITE, PERMISOS.COBROS_DELETE, PERMISOS.COBROS_PRECIO_HISTORICO, PERMISOS.SOCIOS_READ,
]);
const cobradorSinPrecioHistorico = () => crearUsuarioConPermisos('cobrador', [
  PERMISOS.COBROS_READ, PERMISOS.COBROS_WRITE, PERMISOS.COBROS_DELETE, PERMISOS.SOCIOS_READ,
]);

// Ejemplo del issue: $10.000 hasta junio, $12.000 desde julio, $15.000 desde
// septiembre (sin cierre). Los cierres son los que deja resolverVigenciaPrecio
// al cargar el precio siguiente desde la UI (desde − 24 h).
const setupEjemploIssue = async () => {
  const socio = await createSocio();
  const etiqueta = await createEtiqueta();
  await createPrecio({ etiquetaId: etiqueta._id, monto: 10000, vigenteDesde: D('2026-01-01'), vigenteHasta: D('2026-06-30') });
  await createPrecio({ etiquetaId: etiqueta._id, monto: 12000, vigenteDesde: D('2026-07-01'), vigenteHasta: D('2026-08-31') });
  await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: D('2026-09-01') });
  const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-03' });
  return { socio, etiqueta, suscripcion };
};

const PERIODOS_EJEMPLO = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];

const postCobro = (token, body) => request(app)
  .post('/api/cobros')
  .set('Authorization', `Bearer ${token}`)
  .send({ paymentMethod: 'Efectivo', ...body });

const itemEjemplo = ({ socio, suscripcion }, extra = {}) => ({
  socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodos: PERIODOS_EJEMPLO, ...extra,
});

describe('Precio histórico (#285, integración)', () => {
  it('ejemplo del issue: $120.000 a precio actual y $94.000 a precio de cada mes', async () => {
    const { token } = await secretaria();
    const { socio } = await setupEjemploIssue();

    const res = await request(app).get(`/api/socios/${socio._id}/deuda`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [deuda] = res.body.suscripciones;
    expect(deuda.periodos).toEqual(PERIODOS_EJEMPLO);
    expect(deuda.precioUnitario).toBe(15000);
    expect(deuda.totalDeuda).toBe(120000);
    expect(deuda.totalDeudaPrecioHistorico).toBe(94000);
    expect(deuda.desglosePrecioHistorico).toEqual([
      { periodo: '2026-03', monto: 10000 },
      { periodo: '2026-04', monto: 10000 },
      { periodo: '2026-05', monto: 10000 },
      { periodo: '2026-06', monto: 10000 },
      { periodo: '2026-07', monto: 12000 },
      { periodo: '2026-08', monto: 12000 },
      { periodo: '2026-09', monto: 15000 },
      { periodo: '2026-10', monto: 15000 },
    ]);
  });

  it('sin cobros:precio-historico la deuda no trae el desglose y totalDeuda es el mismo', async () => {
    const { token } = await cobradorSinPrecioHistorico();
    const { socio } = await setupEjemploIssue();

    const res = await request(app).get(`/api/socios/${socio._id}/deuda`).set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const [deuda] = res.body.suscripciones;
    expect(deuda.totalDeuda).toBe(120000);
    expect(deuda).not.toHaveProperty('desglosePrecioHistorico');
    expect(deuda).not.toHaveProperty('totalDeudaPrecioHistorico');
  });

  it('cobra el ejemplo del issue a precio de cada mes: $94.000, con modo y motivo registrados y en auditoría', async () => {
    const { token, user } = await secretaria();
    const ctx = await setupEjemploIssue();

    const res = await postCobro(token, {
      modoPrecio: 'historico',
      motivoPrecioHistorico: `  ${MOTIVO}  `,
      items: [itemEjemplo(ctx)],
    });

    expect(res.status).toBe(201);
    expect(res.body.cobro.totalAmount).toBe(94000);
    expect(res.body.cobro.modoPrecio).toBe('historico');
    expect(res.body.cobro.motivoPrecioHistorico).toBe(MOTIVO);
    expect(res.body.cobro.createdBy).toBe(user.email);

    const cobro = await Cobro.findById(res.body.cobro._id).lean();
    expect(cobro.items.map((i) => [i.periodo, i.amount, i.precioSugeridoSnapshot])).toEqual(
      PERIODOS_EJEMPLO.map((p, i) => [p, [10000, 10000, 10000, 10000, 12000, 12000, 15000, 15000][i], 15000]),
    );

    // La Cuota deja ver la diferencia: esperado al precio actual, pagado al de ese mes.
    const marzo = await Cuota.findOne({ clubId: CLUB_ID, socioId: ctx.socio._id, periodo: '2026-03' }).lean();
    expect(marzo.montoEsperadoSnapshot).toBe(15000);
    expect(marzo.montoPagadoSnapshot).toBe(10000);

    // logAudit corre después de responder (sin await): esperarlo un poco.
    await vi.waitFor(async () => {
      const audit = await AuditLog.findOne({ clubId: CLUB_ID, resource: 'Cobro', resourceId: res.body.cobro._id }).lean();
      expect(audit.after.cobro.modoPrecio).toBe('historico');
      expect(audit.after.cobro.motivoPrecioHistorico).toBe(MOTIVO);
    });

    const deuda = await request(app).get(`/api/socios/${ctx.socio._id}/deuda`).set('Authorization', `Bearer ${token}`);
    expect(deuda.body.suscripciones[0].mesesDeuda).toBe(0);
  });

  it('sin modoPrecio el cobro sigue siendo a precio actual ($120.000) y queda como "actual"', async () => {
    const { token } = await cobradorSinPrecioHistorico();
    const ctx = await setupEjemploIssue();

    const res = await postCobro(token, { items: [itemEjemplo(ctx)] });

    expect(res.status).toBe(201);
    expect(res.body.cobro.totalAmount).toBe(120000);
    expect(res.body.cobro.modoPrecio).toBe('actual');
    expect(res.body.cobro.motivoPrecioHistorico).toBeNull();
  });

  it('sin el permiso: 403 aunque el body pida modo histórico (y no registra nada)', async () => {
    const { token } = await cobradorSinPrecioHistorico();
    const ctx = await setupEjemploIssue();

    const res = await postCobro(token, { modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemEjemplo(ctx)] });

    expect(res.status).toBe(403);
    expect(await Cobro.countDocuments({ clubId: CLUB_ID })).toBe(0);
  });

  it('un modoPrecio que no es exactamente "actual" o "historico" da 400 (no se normaliza para saltear el permiso)', async () => {
    const { token } = await cobradorSinPrecioHistorico();
    const ctx = await setupEjemploIssue();

    for (const modoPrecio of ['Historico', 'historico ', 'histórico', 'otro']) {
      const res = await postCobro(token, { modoPrecio, motivoPrecioHistorico: MOTIVO, items: [itemEjemplo(ctx)] });
      expect(res.status, modoPrecio).toBe(400);
    }
    expect(await Cobro.countDocuments({ clubId: CLUB_ID })).toBe(0);
  });

  it('con el permiso pero sin motivo (o con menos de 10 caracteres sin espacios): 400', async () => {
    const { token } = await secretaria();
    const ctx = await setupEjemploIssue();

    for (const motivoPrecioHistorico of [undefined, '', '     ', 'a b c d e f g h i']) {
      const res = await postCobro(token, { modoPrecio: 'historico', motivoPrecioHistorico, items: [itemEjemplo(ctx)] });
      expect(res.status, String(motivoPrecioHistorico)).toBe(400);
      expect(res.body.message).toMatch(/motivo/i);
    }
    expect(await Cobro.countDocuments({ clubId: CLUB_ID })).toBe(0);
  });

  it('en modo histórico, un amount en un item de suscripción da 400', async () => {
    const { token } = await secretaria();
    const ctx = await setupEjemploIssue();

    const res = await postCobro(token, {
      modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemEjemplo(ctx, { amount: 94000 })],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/importe/i);
    expect(await Cobro.countDocuments({ clubId: CLUB_ID })).toBe(0);
  });

  it('un mes adeudado sin precio bloquea el modo histórico con un mensaje que nombra el mes', async () => {
    const { token } = await secretaria();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    // Sin precio para febrero: el primero arranca en marzo.
    await createPrecio({ etiquetaId: etiqueta._id, monto: 10000, vigenteDesde: D('2026-03-01') });
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-02' });

    const res = await postCobro(token, {
      modoPrecio: 'historico',
      motivoPrecioHistorico: MOTIVO,
      items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodos: ['2026-02', '2026-03'] }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('febrero 2026');
    expect(res.body.message).toContain('Cuota Social');
    expect(await Cobro.countDocuments({ clubId: CLUB_ID })).toBe(0);

    // La deuda lo muestra igual: total histórico null y el mes con monto null.
    const deuda = await request(app).get(`/api/socios/${socio._id}/deuda`).set('Authorization', `Bearer ${token}`);
    const [d] = deuda.body.suscripciones;
    expect(d.totalDeuda).toBe(9 * 10000); // febrero a octubre al precio de hoy: no cambia
    expect(d.totalDeudaPrecioHistorico).toBeNull();
    expect(d.desglosePrecioHistorico[0]).toEqual({ periodo: '2026-02', monto: null });
    expect(d.desglosePrecioHistorico[1]).toEqual({ periodo: '2026-03', monto: 10000 });
  });

  it('no usa precios de otro club para resolver el precio de cada mes', async () => {
    const { token } = await secretaria();
    const socio = await createSocio();
    const etiqueta = await createEtiqueta();
    await createPrecio({ etiquetaId: etiqueta._id, monto: 15000, vigenteDesde: D('2026-09-01') });
    // Mismo etiquetaId, otro club: no tiene que tapar el hueco de agosto.
    await createPrecio({ etiquetaId: etiqueta._id, monto: 1, vigenteDesde: D('2020-01-01'), clubId: 'OTRO' });
    const suscripcion = await createSuscripcion({ socioId: socio._id, etiquetaId: etiqueta._id, fechaDesde: '2026-08' });

    const deuda = await request(app).get(`/api/socios/${socio._id}/deuda`).set('Authorization', `Bearer ${token}`);
    expect(deuda.body.suscripciones[0].desglosePrecioHistorico[0]).toEqual({ periodo: '2026-08', monto: null });

    const res = await postCobro(token, {
      modoPrecio: 'historico',
      motivoPrecioHistorico: MOTIVO,
      items: [{ socioId: String(socio._id), suscripcionId: String(suscripcion._id), periodos: ['2026-08'] }],
    });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('agosto 2026');
  });

  it('cambiar la forma de pago de un cobro histórico funciona sin el permiso y conserva modo, motivo e importes; crear uno nuevo en ese modo no', async () => {
    const { token: tokenSecretaria } = await secretaria();
    const { token: tokenCobrador } = await cobradorSinPrecioHistorico();
    const ctx = await setupEjemploIssue();

    const original = await postCobro(tokenSecretaria, {
      modoPrecio: 'historico', motivoPrecioHistorico: MOTIVO, items: [itemEjemplo(ctx)],
    });
    expect(original.status).toBe(201);

    const cambio = await request(app)
      .put(`/api/cobros/${original.body.cobro._id}/forma-pago`)
      .set('Authorization', `Bearer ${tokenCobrador}`)
      .send({ paymentMethod: 'Transferencia' });

    expect(cambio.status).toBe(201);
    const nuevo = await Cobro.findOne({ clubId: CLUB_ID, active: true, paymentMethod: 'Transferencia' }).lean();
    expect(nuevo.totalAmount).toBe(94000);
    expect(nuevo.modoPrecio).toBe('historico');
    expect(nuevo.motivoPrecioHistorico).toBe(MOTIVO);
    expect(nuevo.items.map((i) => i.precioSugeridoSnapshot)).toEqual(PERIODOS_EJEMPLO.map(() => 15000));

    // El mismo usuario no puede crear un cobro nuevo en modo histórico.
    const otroSocio = await createSocio();
    const otraSuscripcion = await createSuscripcion({ socioId: otroSocio._id, etiquetaId: ctx.etiqueta._id, fechaDesde: '2026-03' });
    const nuevoHistorico = await postCobro(tokenCobrador, {
      modoPrecio: 'historico',
      motivoPrecioHistorico: MOTIVO,
      items: [itemEjemplo({ socio: otroSocio, suscripcion: otraSuscripcion })],
    });
    expect(nuevoHistorico.status).toBe(403);
  });

  it('el parámetro interno para conservar el modo histórico no se puede mandar por el body', async () => {
    const { token } = await cobradorSinPrecioHistorico();
    const ctx = await setupEjemploIssue();

    const res = await postCobro(token, {
      precioHistoricoHeredado: { motivo: MOTIVO },
      motivoPrecioHistorico: MOTIVO,
      items: [itemEjemplo(ctx)],
    });

    expect(res.status).toBe(201);
    expect(res.body.cobro.totalAmount).toBe(120000);
    expect(res.body.cobro.modoPrecio).toBe('actual');
    expect(res.body.cobro.motivoPrecioHistorico).toBeNull();
  });

  it('en modo histórico, los cargos puntuales del mismo cobro no cambian y aceptan amount', async () => {
    const { token } = await secretaria();
    const ctx = await setupEjemploIssue();
    const CargoPuntual = (await import('../../../cargosPuntuales/models/CargoPuntual.js')).default;
    const cargo = await CargoPuntual.create({
      clubId: CLUB_ID,
      socioId: ctx.socio._id,
      etiquetaId: ctx.etiqueta._id,
      periodo: '2026-10',
      description: 'Remera',
      montoEsperadoSnapshot: 8000,
      precioSugeridoSnapshot: 8000,
      estado: 'pendiente',
      createdBy: 'test',
      updatedBy: 'test',
    });

    const res = await postCobro(token, {
      modoPrecio: 'historico',
      motivoPrecioHistorico: MOTIVO,
      items: [itemEjemplo(ctx), { socioId: String(ctx.socio._id), cargoPuntualId: String(cargo._id), amount: 8000 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.cobro.totalAmount).toBe(94000 + 8000);
  });

  it('modo histórico sin ningún item de suscripción da 400', async () => {
    const { token } = await secretaria();
    const ctx = await setupEjemploIssue();
    const CargoPuntual = (await import('../../../cargosPuntuales/models/CargoPuntual.js')).default;
    const cargo = await CargoPuntual.create({
      clubId: CLUB_ID,
      socioId: ctx.socio._id,
      etiquetaId: ctx.etiqueta._id,
      periodo: '2026-10',
      description: 'Remera',
      montoEsperadoSnapshot: 8000,
      precioSugeridoSnapshot: 8000,
      estado: 'pendiente',
      createdBy: 'test',
      updatedBy: 'test',
    });

    const res = await postCobro(token, {
      modoPrecio: 'historico',
      motivoPrecioHistorico: MOTIVO,
      items: [{ socioId: String(ctx.socio._id), cargoPuntualId: String(cargo._id) }],
    });

    expect(res.status).toBe(400);
    expect(await Cobro.countDocuments({ clubId: CLUB_ID })).toBe(0);
  });
});
