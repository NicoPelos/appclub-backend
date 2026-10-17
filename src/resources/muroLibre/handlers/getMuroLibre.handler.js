import Asistencia from '../../asistencias/models/Asistencia.js';
import { tienePermiso } from '../../../services/permisosCache.js';
import { PERMISOS } from '../../../constants/permisos.js';

/**
 * @openapi
 * /api/muro-libre:
 *   get:
 *     summary: Listar asistencias de muro libre
 *     tags: [MuroLibre]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: page
 *         in: query
 *         schema: { type: integer, default: 1 }
 *       - name: limit
 *         in: query
 *         schema: { type: integer, default: 100 }
 *       - name: from
 *         in: query
 *         description: Fecha desde (YYYY-MM-DD)
 *         schema: { type: string, format: date }
 *       - name: to
 *         in: query
 *         description: Fecha hasta (YYYY-MM-DD)
 *         schema: { type: string, format: date }
 *       - name: socioId
 *         in: query
 *         description: Acota a un socio puntual. Para cuentas sin muroLibre:write, siempre se ignora y se fuerza al propio socioId.
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Lista paginada de asistencias de muro libre
 *       500:
 *         description: Error al obtener muro libre
 */
export const getMuroLibreHandler = async (req, res) => {
  try {
    const { page = 1, limit = 100, from, to, socioId } = req.query;
    const pageNumber = Math.max(parseInt(page, 10) || 1, 1);
    const pageSize = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);
    const filter = { clubId: req.user?.clubId, tipo: 'muro_libre', active: true };

    // roles.every(r => r === 'socio') no alcanza para decidir el auto-scope:
    // un profesor que también es socio del club (caso real) tiene el rol
    // 'socio' de más, así que ese chequeo daba isSocioOnly=false y terminaba
    // viendo el registro de TODO el club en vez de solo el propio. El criterio
    // correcto es si el usuario tiene manejo de muro libre (staff), no si
    // "solo" tiene el rol socio — autoridad se suma aparte porque ve todo en
    // modo lectura sin tener muroLibre:write.
    const rolesUsuario = req.user?.roles ?? [];
    const esStaffMuroLibre = rolesUsuario.includes('autoridad')
      || await tienePermiso(req.user?.clubId, rolesUsuario, PERMISOS.MURO_LIBRE_WRITE);

    // Un socio (puro o con rol de staff) siempre queda forzado a su propio
    // socioId, ignorando cualquier otro valor que mande — no puede pedir el
    // historial de otro. Bug real: "Mis Visitas" (mobile) pide explícitamente
    // ?socioId=<el propio>, pero antes de este fix el filtro se ignoraba por
    // completo para cualquier cuenta con muroLibre:write (admin, secretaria,
    // palestrero) — un admin que es socio veía el listado de TODO el club en
    // su propia pantalla de "mis visitas" en vez de las suyas.
    if (!esStaffMuroLibre && req.user?.socioId) {
      filter.socioId = req.user.socioId;
    } else if (esStaffMuroLibre && socioId) {
      filter.socioId = socioId;
    }

    if (from || to) {
      filter.fecha = {};
      if (from) filter.fecha.$gte = new Date(`${from}T00:00:00.000Z`);
      if (to)   filter.fecha.$lte = new Date(`${to}T23:59:59.999Z`);
    }

    const [total, registros] = await Promise.all([
      Asistencia.countDocuments(filter),
      Asistencia.find(filter)
        .sort({ fecha: -1, createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize),
    ]);

    res.status(200).json({
      page: pageNumber,
      limit: pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      registros,
    });
  } catch (error) {
    console.error('Error obteniendo muro libre:', error);
    res.status(500).json({ message: 'Error al obtener muro libre' });
  }
};

export default getMuroLibreHandler;
