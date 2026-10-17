import Notification from '../../notificaciones/models/Notification.js';
import Socio from '../../socios/models/Socio.js';
import { notifyRolesByPermiso } from '../../../services/pushNotification.service.js';
import { diaBoundsUTC } from '../../../services/fechaArgentina.js';
import { mensajePrecioNoVigente } from '../../../services/precioNoVigente.js';
import { PERMISOS } from '../../../constants/permisos.js';

export const TIPO_AVISO = 'precio_no_vigente_pago_online';

/**
 * Un socio quiso pagar online una cuota sin precio vigente (#317): él no
 * puede resolverlo, así que se avisa a quien puede cargar precios.
 *
 * Como mucho un aviso por etiqueta y por día (horario argentino), para que
 * diez socios intentando pagar no sean diez notificaciones. El límite se
 * apoya en el historial de notificaciones (lo que ya se le mandó al staff
 * hoy), sin estado aparte; dos intentos simultáneos pueden generar dos
 * avisos, que es aceptable.
 */
export const avisarPrecioNoVigentePagoOnline = async ({ clubId, etiqueta, socioId, periodo }) => {
  const etiquetaId = String(etiqueta._id);
  const { start: inicioHoy } = diaBoundsUTC(new Date());

  const yaAvisado = await Notification.exists({
    clubId,
    'data.tipo': TIPO_AVISO,
    'data.etiquetaId': etiquetaId,
    createdAt: { $gte: inicioHoy },
  });
  if (yaAvisado) return { avisado: false };

  const socio = await Socio.findOne({ _id: socioId, clubId }).select('nombre apellido').lean();
  const quien = socio ? `${socio.nombre} ${socio.apellido}`.trim() : 'Un socio';

  await notifyRolesByPermiso(clubId, PERMISOS.PRECIOS_READ, {
    title: '⚠️ Un socio no pudo pagar online',
    body: `${quien} quiso pagar con Mercado Pago y no pudo. ${mensajePrecioNoVigente({ etiquetaNombre: etiqueta.nombre, periodo })}`,
    data: { tipo: TIPO_AVISO, etiquetaId, periodo, url: 'carc://precios' },
  });
  return { avisado: true };
};
