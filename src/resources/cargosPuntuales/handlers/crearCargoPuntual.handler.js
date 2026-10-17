import { crearCargoPuntual, BusinessError } from '../services/crearCargoPuntual.service.js';
import { logAudit } from '../../audit/services/audit.service.js';

/**
 * @openapi
 * /api/cargos-puntuales:
 *   post:
 *     summary: Atribuir un cargo puntual (no recurrente) a un socio, ej. un viaje o una inscripción
 *     tags: [CargosPuntuales]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [socioId, etiquetaId, description]
 *             properties:
 *               socioId:
 *                 type: string
 *               etiquetaId:
 *                 type: string
 *                 description: Etiqueta de unidad "unico" que determina el precio sugerido
 *               description:
 *                 type: string
 *                 example: "Trekking a Cerro Negro"
 *               monto:
 *                 type: number
 *                 description: Si no se envía, se usa el precio vigente de la etiqueta
 *     responses:
 *       201:
 *         description: Cargo puntual creado (estado pendiente)
 *       400:
 *         description: Datos inválidos
 *       404:
 *         description: Socio o etiqueta no encontrados
 */
export const crearCargoPuntualHandler = async (req, res) => {
  try {
    const cargo = await crearCargoPuntual({ clubId: req.user?.clubId, user: req.user, body: req.body });
    logAudit({ clubId: req.user?.clubId, req, action: 'CREATE', resource: 'CargoPuntual', resourceId: cargo._id, before: null, after: cargo.toObject() });
    return res.status(201).json(cargo);
  } catch (error) {
    if (error instanceof BusinessError) {
      return res.status(error.status).json({ message: error.message, ...(error.data ?? {}) });
    }
    console.error('Error creando cargo puntual:', error);
    return res.status(500).json({ message: 'Error al crear cargo puntual' });
  }
};

export default crearCargoPuntualHandler;
