import mongoose from 'mongoose';
import { calcularDeuda } from '../../cuotas/services/calcularDeuda.service.js';
import { getSocioIdsAccesibles } from '../../vinculos/services/getSocioIdsAccesibles.service.js';
import { tienePermiso } from '../../../services/permisosCache.js';
import { PERMISOS } from '../../../constants/permisos.js';
import { usuarioTienePermiso } from '../../../middleware/auth.js';

/**
 * @openapi
 * /api/socios/{id}/deuda:
 *   get:
 *     summary: Calcular deuda de un socio basada en sus suscripciones activas
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Deuda por suscripciones (mensual) y deuda por visitas pendientes de Muro Libre
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 suscripciones:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       suscripcionId: { type: string }
 *                       etiqueta:
 *                         type: object
 *                         properties:
 *                           nombre: { type: string }
 *                           unidad: { type: string }
 *                           uso_sistema: { type: string, nullable: true }
 *                       fechaDesde: { type: string }
 *                       fechaHasta: { type: string, nullable: true }
 *                       vigente:
 *                         type: boolean
 *                         description: El tramo sigue en curso (fechaHasta null o mayor o igual al período actual, hora argentina). Usarlo para separar planes vigentes del historial.
 *                       ultimoPeriodoPagado: { type: string, nullable: true }
 *                       periodoActual: { type: string }
 *                       mesesDeuda: { type: integer }
 *                       periodos: { type: array, items: { type: string } }
 *                       precioUnitario: { type: number, nullable: true }
 *                       totalDeuda:
 *                         type: number
 *                         nullable: true
 *                         description: Deuda al precio de hoy (mesesDeuda × precioUnitario). Es el total por defecto.
 *                       desglosePrecioHistorico:
 *                         type: array
 *                         description: "Solo para quien tiene cobros:precio-historico (sin el permiso el campo no viene). Cada mes adeudado con el precio que regía ese mes (1° del mes, 00:00 hora argentina). monto null si ese mes no tiene precio cargado. Vacío si no debe nada (#285)."
 *                         items:
 *                           type: object
 *                           properties:
 *                             periodo: { type: string, example: '2026-03' }
 *                             monto: { type: number, nullable: true }
 *                       totalDeudaPrecioHistorico:
 *                         type: number
 *                         nullable: true
 *                         description: "Solo para quien tiene cobros:precio-historico (sin el permiso el campo no viene). Suma de desglosePrecioHistorico; null si algún mes no tiene precio. Es lo que se cobra con modoPrecio 'historico' en POST /api/cobros."
 *                 muroLibre:
 *                   type: object
 *                   nullable: true
 *                   properties:
 *                     visitasPendientes: { type: integer }
 *                     fechas: { type: array, items: { type: string, format: date-time } }
 *                     totalDeuda: { type: number }
 *       403:
 *         description: Sin permiso para ver la deuda de este socio
 *       404:
 *         description: Socio no encontrado
 *       500:
 *         description: Error al calcular deuda
 */
export const getSocioDeudaHandler = async (req, res) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(404).json({ message: 'Socio no encontrado' });
  }

  const ROLES_PRIVILEGED = ['admin', 'secretaria', 'autoridad', 'superadmin'];
  // Roles históricos + cualquier rol (custom del club) con socios:read: los
  // nombres de rol son configurables, el permiso es lo que manda (#191).
  const canViewAll = req.user.roles?.some(r => ROLES_PRIVILEGED.includes(r))
    || (req.user.roles?.length > 0 && await tienePermiso(req.user.clubId, req.user.roles, PERMISOS.SOCIOS_READ));
  if (!canViewAll) {
    // No alcanza con "el propio perfil activo" (req.user.socioId) — un tutor
    // tiene que poder consultar la deuda de sus hijos vinculados también,
    // sin necesidad de cambiar de perfil (ver CuotasScreen.tsx, que pide la
    // deuda de todos los perfiles accesibles de una sola vez).
    const { accessibleIds } = await getSocioIdsAccesibles({ clubId: req.user.clubId, userId: req.user.id });
    if (!accessibleIds.has(id)) {
      return res.status(403).json({ message: 'No tenés permiso para ver la deuda de este socio' });
    }
  }

  try {
    // El precio de cada mes solo le sirve a quien puede cobrar así: un socio
    // no ve en su propia deuda cuánto sería "a precio de cada mes" (#285).
    const incluirPrecioHistorico = await usuarioTienePermiso(req.user, PERMISOS.COBROS_PRECIO_HISTORICO);
    const deuda = await calcularDeuda({ socioId: id, clubId: req.user.clubId, incluirPrecioHistorico });
    return res.status(200).json(deuda);
  } catch (error) {
    console.error('Error calculando deuda:', error);
    return res.status(500).json({ message: 'Error al calcular deuda' });
  }
};

export default getSocioDeudaHandler;
