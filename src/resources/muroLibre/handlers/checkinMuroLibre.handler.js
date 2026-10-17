import { BusinessError, registrarMuroLibre } from '../services/registrarMuroLibre.service.js';
import { resolveSocioFromQrTokenOrDni, findActiveSocioById, getPaseMuroLibreVigente } from '../../socios/services/socioQr.service.js';
import { notifyRolesByPermiso, notifySocio } from '../../../services/pushNotification.service.js';
import { tienePermiso } from '../../../services/permisosCache.js';
import { PERMISOS } from '../../../constants/permisos.js';
import { pasesIncluidosSemana } from '../services/pasesClases.service.js';

/**
 * @openapi
 * /api/muro-libre/checkin:
 *   post:
 *     summary: Registrar check-in en muro libre
 *     tags: [MuroLibre]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - tipoPase
 *             properties:
 *               token:
 *                 type: string
 *                 description: Token QR del socio
 *               dni:
 *                 type: string
 *                 description: DNI del socio
 *               tipoPase:
 *                 type: string
 *                 enum: [diario, mensual]
 *                 description: Tipo de pase
 *               estadoPago:
 *                 type: string
 *                 enum: [pagado, pendiente, exento]
 *                 description: Estado de pago
 *               paymentMethod:
 *                 type: string
 *                 enum: [Efectivo, Transferencia]
 *                 description: Forma de pago
 *               amount:
 *                 type: number
 *                 description: Monto del pase diario — opcional, si no se manda toma el precio vigente configurado
 *               enviarComprobanteWp:
 *                 type: boolean
 *                 description: Indica si se debe enviar comprobante por WhatsApp
 *               observaciones:
 *                 type: string
 *                 description: Observaciones adicionales
 *               fecha:
 *                 type: string
 *                 format: date-time
 *                 description: Fecha del check-in (default ahora) — para cargar asistencia de un día anterior
 *     responses:
 *       201:
 *         description: Check-in registrado exitosamente
 *       400:
 *         description: Error en los datos enviados para el check-in
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al registrar check-in
 */

export const checkinMuroLibreHandler = async (req, res) => {
  try {
    const { token, dni, tipoPase, estadoPago, paymentMethod, amount, enviarComprobanteWp, observaciones, fecha, confirmarDeuda } = req.body;

    // La decisión de qué flujo usar depende de si LA REQUEST trae token/dni
    // explícito, no de qué permisos tiene quien llama — un miembro del staff
    // que además es socio y escanea el cartel de pared para sí mismo tiene que
    // poder autoescanearse igual (appCARC-mobile#60, bug encontrado en vivo:
    // el admin/secretaria quedaba forzado siempre al flujo de staff porque
    // esStaff daba true, aunque el body viniera vacío).
    const identificacionExplicita = Boolean(token || dni);

    // Autoescaneo del QR de pared: se ignora cualquier permiso de staff que
    // tenga quien llama y se fuerza la identidad al usuario logueado (o a un
    // hijo vinculado, si aplicara). También se auto-detecta si tiene pase
    // mensual vigente (en vez de asumir "diario" y crear una deuda que ya
    // está cubierta, ver issue #81) en vez de tomar tipoPase/estadoPago del body.
    let socio;
    let method;
    let tipoPaseFinal = tipoPase;
    let estadoPagoFinal = estadoPago;

    if (identificacionExplicita) {
      const roles = req.user?.roles ?? [];
      const esStaff = roles.includes('superadmin')
        || await tienePermiso(req.user?.clubId, roles, PERMISOS.MURO_LIBRE_CHECKIN);
      if (!esStaff) {
        throw new BusinessError('No tenés permiso para registrar el check-in de otro socio', 403);
      }
      ({ socio, method } = await resolveSocioFromQrTokenOrDni({
        token,
        dni,
        clubId: req.user?.clubId,
        missingMessage: 'Se requiere token QR o DNI para identificar el socio',
      }));
    } else {
      if (!req.user?.socioId) {
        throw new BusinessError('Tu usuario no tiene un socio asociado', 403);
      }
      socio = await findActiveSocioById(req.user.socioId, req.user.clubId);
      if (!socio) {
        throw new BusinessError('Socio no encontrado o inactivo', 404);
      }
      method = 'SELF';

      // Solo hace falta saber si está suscripto al pase mensual — si lo está
      // pero no pagó el período actual, registrarMuroLibre ya se encarga de
      // avisarlo (advertencia PASE_MENSUAL_IMPAGO) sin bloquear el check-in.
      const pase = await getPaseMuroLibreVigente(socio._id, req.user.clubId);
      tipoPaseFinal = pase.suscripto ? 'mensual' : 'diario';
      estadoPagoFinal = 'pendiente';
    }

    const advertencias = [];
    const result = await registrarMuroLibre({
      clubId: req.user?.clubId,
      user: req.user,
      body: {
        socioId: String(socio._id),
        tipoPase: tipoPaseFinal,
        estadoPago: estadoPagoFinal,
        paymentMethod: identificacionExplicita ? paymentMethod : undefined,
        amount: identificacionExplicita ? amount : undefined,
        enviarComprobanteWp,
        observaciones,
        autoescaneo: !identificacionExplicita,
        confirmarDeuda: confirmarDeuda === true,
        // "fecha" es para que STAFF cargue asistencia de un día anterior
        // (identificacionExplicita) — en el autoescaneo (self) se ignora y
        // se deja que registrarMuroLibre use "ahora" por default, si no un
        // socio podía mandar cualquier fecha pasada/futura vía request
        // directo a la API y fabricar historial de asistencia a su gusto,
        // ya que el único límite es uno por día (appcarc-backend#154).
        fecha: identificacionExplicita ? fecha : undefined,
      },
      scannedBy: req.user?.id,
      checkinMethod: method,
      advertencias,
    });

    const advertenciasResult = result.advertencias ?? [];
    if (advertenciasResult.length > 0) {
      const nombreCompleto = `${socio.nombre} ${socio.apellido}`;
      const resumen = advertenciasResult.map((a) => a.mensaje).join(' | ');
      Promise.all([
        notifyRolesByPermiso(req.user?.clubId, PERMISOS.ADVERTENCIAS_READ, {
          title: '⚠️ Ingreso con advertencias',
          body: `${nombreCompleto} ingresó a muro libre con ${advertenciasResult.length} advertencia(s): ${resumen}`,
          data: { tipo: 'advertencia_checkin', asistenciaId: String(result.registro._id), url: 'carc://advertencias?tipo=muro_libre' },
        }),
        notifySocio(socio._id, {
          title: '⚠️ Advertencias en tu ingreso',
          body: resumen,
          data: { tipo: 'advertencia_socio', url: 'carc://cuotas' },
        }),
      ]).catch((err) => console.error('[Push] Error enviando notificaciones de advertencia:', err.message));
    }

    const pasesSemana = method === 'SELF' ? await pasesIncluidosSemana({ clubId: req.user?.clubId, socioId: socio._id, fecha: new Date() }) : undefined;
    res.status(201).json({ asistencia: result.registro, movimiento: result.movimiento, socio, advertencias: advertenciasResult, ...(pasesSemana ? { pasesSemana } : {}) });
  } catch (error) {
    if (error instanceof BusinessError || error.status) {
      return res.status(error.status).json({ message: error.message, ...(error.data ?? {}) });
    }

    console.error('Error en el checkin de muro libre:', error);
    res.status(500).json({ message: 'Error en el checkin de muro libre' });
  }
};

export default checkinMuroLibreHandler;
