import { BusinessError, registrarCobro } from '../services/registrarCobro.service.js';
import { sendPushNotification } from '../../../services/pushNotification.service.js';
import User from '../../usuarios/models/User.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import { logAudit } from '../../audit/services/audit.service.js';

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];

const formatPeriodo = (periodo) => {
  const [year, month] = periodo.split('-');
  return `${MESES[parseInt(month, 10) - 1]} ${year}`;
};

const buildCuotaBody = (cuotas, etiquetaNombreById) => {
  const label = (c) => (etiquetaNombreById.get(String(c.etiquetaId)) || 'cuota').toLowerCase();
  if (cuotas.length === 1) {
    const c = cuotas[0];
    return `Se registró el pago de tu ${label(c)} para ${formatPeriodo(c.periodo)}`;
  }
  const lista = cuotas.map((c) => `${label(c)} ${formatPeriodo(c.periodo)}`).join(', ');
  return `Se registraron ${cuotas.length} pagos: ${lista}`;
};

const buildCargoPuntualBody = (cargos) => {
  if (cargos.length === 1) {
    return `Se registró el pago de "${cargos[0].description}"`;
  }
  const lista = cargos.map((c) => `"${c.description}"`).join(', ');
  return `Se registraron ${cargos.length} pagos puntuales: ${lista}`;
};

/**
 * @openapi
 * components:
 *   schemas:
 *     CobroRequest:
 *       type: object
 *       required:
 *         - paymentMethod
 *         - items
 *       properties:
 *         date:
 *           type: string
 *           format: date-time
 *           description: Fecha del cobro. Si no se envía, usa la fecha actual.
 *         paymentMethod:
 *           type: string
 *           enum: [Efectivo, Transferencia]
 *           description: Forma de pago (Efectivo o Transferencia)
 *         responsable:
 *           type: string
 *           description: Responsable del cobro. Si no se envía, usa el email del usuario logueado.
 *         description:
 *           type: string
 *           description: Descripción opcional del cobro
 *         modoPrecio:
 *           type: string
 *           enum: [actual, historico]
 *           default: actual
 *           description: "'historico' cobra cada mes de suscripción al precio que regía ese mes (1° del mes, 00:00 hora argentina). Requiere el permiso cobros:precio-historico y motivoPrecioHistorico; el servidor calcula los importes (amount en esos items → 400) y bloquea si un mes no tiene precio. Ver appcarc-backend#285."
 *         motivoPrecioHistorico:
 *           type: string
 *           minLength: 10
 *           description: Obligatorio con modoPrecio 'historico' (mínimo 10 caracteres sin contar espacios). Queda guardado en el cobro y en auditoría.
 *         items:
 *           type: array
 *           minItems: 1
 *           items:
 *             $ref: '#/components/schemas/CobroItemRequest'
 *     CobroItemRequest:
 *       type: object
 *       required:
 *         - socioId
 *       properties:
 *         socioId:
 *           type: string
 *           description: ID del socio al que corresponde la cuota.
 *         suscripcionId:
 *           type: string
 *           description: ID de la suscripción del socio (determina la etiqueta/precio). Requerido salvo que se envíe cargoPuntualId.
 *         cargoPuntualId:
 *           type: string
 *           description: Alternativa a suscripcionId para saldar un cargo puntual previamente atribuido en /api/cargos-puntuales.
 *         periodo:
 *           type: string
 *           pattern: '^\d{4}-(0[1-9]|1[0-2])$'
 *           example: "2026-06"
 *         periodoDesde:
 *           type: string
 *           pattern: '^\d{4}-(0[1-9]|1[0-2])$'
 *           example: "2026-06"
 *         periodos:
 *           type: array
 *           items:
 *             type: string
 *             pattern: '^\d{4}-(0[1-9]|1[0-2])$'
 *         cantidad:
 *           type: integer
 *           minimum: 1
 *           default: 1
 *           description: "Para muroLibrePendiente: si no viene asistenciaIds, paga las N visitas pendientes más viejas"
 *         asistenciaIds:
 *           type: array
 *           items: { type: string }
 *           description: "Para muroLibrePendiente: visitas puntuales a pagar (tiene prioridad sobre cantidad)"
 *         amount:
 *           type: number
 *           minimum: 0
 *           description: Importe unitario confirmado. Si no se envía, se usa el precio vigente. Prohibido en items de suscripción con modoPrecio 'historico'.
 *         precioSugeridoSnapshot:
 *           type: number
 *           minimum: 0
 *         description:
 *           type: string
 */
// 'MercadoPago' como paymentMethod solo lo asigna procesarPagoMercadoPago.service.js
// al confirmar un pago online (webhook) — este endpoint es el único punto de entrada
// donde un humano con permiso cobros:write podría mandarlo a mano, así que se corta
// acá antes de llegar a registrarCobro (que sí lo acepta, para el flujo interno).
const HANDLER_VALID_PAYMENT_METHODS = ['Efectivo', 'Transferencia'];

export const createCobroHandler = async (req, res) => {
  try {
    if (!HANDLER_VALID_PAYMENT_METHODS.includes(String(req.body?.paymentMethod || '').trim())) {
      throw new BusinessError('La forma de pago debe ser Efectivo o Transferencia');
    }

    const result = await registrarCobro({
      clubId: req.user?.clubId,
      user: req.user,
      body: req.body,
    });

    res.status(201).json(result);

    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'Cobro', resourceId: result.cobro._id, before: null, after: { cobro: result.cobro, cuotas: result.cuotas, cargosPuntuales: result.cargosPuntuales } });

    const groupBySocioId = (docs) => docs.reduce((acc, doc) => {
      const key = doc.socioId.toString();
      if (!acc[key]) acc[key] = [];
      acc[key].push(doc);
      return acc;
    }, {});

    const cuotasBySocioId = groupBySocioId(result.cuotas);
    const cargosPuntualesBySocioId = groupBySocioId(result.cargosPuntuales ?? []);

    const etiquetaIds = [...new Set([
      ...result.cuotas.map((c) => c.etiquetaId),
      ...(result.cargosPuntuales ?? []).map((c) => c.etiquetaId),
    ].filter(Boolean).map(String))];
    const etiquetas = etiquetaIds.length
      ? await Etiqueta.find({ _id: { $in: etiquetaIds } }, 'nombre').lean()
      : [];
    const etiquetaNombreById = new Map(etiquetas.map((e) => [String(e._id), e.nombre]));

    const socioIds = [...new Set([...Object.keys(cuotasBySocioId), ...Object.keys(cargosPuntualesBySocioId)])];
    const users = await User.find({
      socioId: { $in: socioIds },
      clubId: req.user?.clubId,
      active: true,
    }).select('socioId clubId expoPushToken').lean();

    for (const user of users) {
      const cuotas = cuotasBySocioId[user.socioId] ?? [];
      const cargosPuntuales = cargosPuntualesBySocioId[user.socioId] ?? [];
      if (!cuotas.length && !cargosPuntuales.length) continue;

      const body = [
        cuotas.length ? buildCuotaBody(cuotas, etiquetaNombreById) : null,
        cargosPuntuales.length ? buildCargoPuntualBody(cargosPuntuales) : null,
      ].filter(Boolean).join('. ');

      sendPushNotification([{ userId: user._id, clubId: user.clubId, token: user.expoPushToken }], {
        title: 'Pago registrado',
        body,
        data: { tipo: 'cobro_registrado', cobroId: result.cobro._id.toString(), url: 'carc://cuotas' },
      }).catch((err) => console.error('Error enviando push de cobro:', err));
    }
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message, ...(error.data ?? {}) });
    }

    console.error('Error registrando cobro:', error);
    res.status(500).json({ message: 'Error al registrar cobro' });
  }
};

export default createCobroHandler;
