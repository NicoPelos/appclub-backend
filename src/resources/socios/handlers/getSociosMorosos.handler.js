import mongoose from 'mongoose';
import Socio from '../models/Socio.js';
import { calcularDeuda } from '../../cuotas/services/calcularDeuda.service.js';
import { filtroSociosVigentes } from '../services/sociosVigentes.service.js';

const COMPARADORES_VALIDOS = ['gte', 'lte', 'eq'];

const cumpleComparador = (mesesDeuda, comparador, meses) => {
  if (mesesDeuda <= 0) return false; // al día no es deuda, sin importar el comparador
  if (comparador === 'eq') return mesesDeuda === meses;
  if (comparador === 'lte') return mesesDeuda <= meses;
  return mesesDeuda >= meses; // gte (default)
};

/**
 * @openapi
 * /api/socios/morosos:
 *   get:
 *     summary: Consulta flexible de socios con deuda — cuotas/suscripciones (comparador de meses, filtro por etiqueta) y/o cargos puntuales y Muro Libre por visita pendientes
 *     tags: [Socios]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: incluirCuotas
 *         schema: { type: boolean, default: true }
 *         description: Si se incluye el criterio de cuotas/suscripciones (comparador+meses)
 *       - in: query
 *         name: comparador
 *         schema: { type: string, enum: [gte, lte, eq], default: gte }
 *       - in: query
 *         name: meses
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: etiquetaId
 *         schema: { type: string }
 *         description: Limitar el criterio de cuotas a un plan/etiqueta puntual (default = cualquiera)
 *       - in: query
 *         name: incluirCargosPuntuales
 *         schema: { type: boolean, default: false }
 *         description: Sumar socios con cargos puntuales pendientes (remeras, viajes, inscripciones, etc.), sin importar el criterio de meses
 *       - in: query
 *         name: incluirMuroLibreVisita
 *         schema: { type: boolean, default: false }
 *         description: Sumar socios con visitas de Muro Libre por día pendientes de pago
 *     responses:
 *       200:
 *         description: Socios que cumplen al menos uno de los criterios activos, ordenados por total adeudado descendente
 *       500:
 *         description: Error al calcular morosos
 */
export const getSociosMorososHandler = async (req, res) => {
  try {
    const clubId = req.user.clubId;
    const incluirCuotas = req.query.incluirCuotas !== 'false';
    const comparador = COMPARADORES_VALIDOS.includes(req.query.comparador) ? req.query.comparador : 'gte';
    const meses = Math.max(parseInt(req.query.meses, 10) || 1, 1);
    const etiquetaId = typeof req.query.etiquetaId === 'string' && req.query.etiquetaId ? req.query.etiquetaId : null;
    if (etiquetaId && !mongoose.isValidObjectId(etiquetaId)) {
      return res.status(400).json({ message: 'etiquetaId inválido' });
    }
    const incluirCargosPuntuales = req.query.incluirCargosPuntuales === 'true';
    const incluirMuroLibreVisita = req.query.incluirMuroLibreVisita === 'true';

    const socios = await Socio.find(filtroSociosVigentes(clubId))
      .select('nombre apellido dni socioNumber telefono correoElectronico estado')
      .lean();

    const resultado = [];
    for (const socio of socios) {
      const deuda = await calcularDeuda({ socioId: socio._id, clubId });

      const deudasCuotas = incluirCuotas
        ? deuda.suscripciones.filter((s) => (
          !s.exento
          && cumpleComparador(s.mesesDeuda, comparador, meses)
          && (!etiquetaId || String(s.etiqueta._id) === etiquetaId)
        ))
        : [];

      const cargosPuntuales = incluirCargosPuntuales
        ? deuda.otrosCargos.filter((c) => c.tipo === 'cargo_puntual')
        : [];

      const muroLibreVisita = incluirMuroLibreVisita
        ? deuda.otrosCargos.filter((c) => c.tipo === 'muro_libre')
        : [];

      if (deudasCuotas.length === 0 && cargosPuntuales.length === 0 && muroLibreVisita.length === 0) continue;

      const totalDeuda = [...deudasCuotas, ...cargosPuntuales, ...muroLibreVisita]
        .reduce((sum, d) => sum + (d.totalDeuda ?? 0), 0);

      resultado.push({
        socio,
        deudasCuotas: deudasCuotas.map((d) => ({ etiqueta: d.etiqueta, mesesDeuda: d.mesesDeuda, totalDeuda: d.totalDeuda })),
        cargosPuntuales: cargosPuntuales.map((c) => ({ cargoPuntualId: c.cargoPuntualId, nombre: c.nombre, descripcion: c.descripcion, totalDeuda: c.totalDeuda })),
        muroLibreVisita: muroLibreVisita.map((c) => ({ nombre: c.nombre, cantidadPendiente: c.cantidadPendiente, totalDeuda: c.totalDeuda })),
        totalDeuda,
      });
    }

    resultado.sort((a, b) => b.totalDeuda - a.totalDeuda);
    res.status(200).json({ total: resultado.length, socios: resultado });
  } catch (error) {
    console.error('Error obteniendo socios morosos:', error);
    res.status(500).json({ message: 'Error al obtener socios morosos' });
  }
};

export default getSociosMorososHandler;
