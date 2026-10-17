import Etiqueta from '../models/Etiqueta.js';
import Precios from '../../cuotas/models/Precios.js';

/**
 * Busca, para un conjunto de etiquetas, el precio vigente de cada una (si
 * tiene) en un solo query — evita N+1 al pedir el listado completo. Puede
 * haber más de un Precios activo por etiqueta con vigenteDesde <= ahora (uno
 * viejo sin vigenteHasta cerrado todavía), así que se queda con el de
 * vigenteDesde más reciente.
 */
const buildPrecioVigentePorEtiqueta = async ({ clubId, etiquetaIds, fecha }) => {
  const precios = await Precios.find({
    clubId,
    etiquetaId: { $in: etiquetaIds },
    active: true,
    vigenteDesde: { $lte: fecha },
    $or: [{ vigenteHasta: null }, { vigenteHasta: { $gte: fecha } }],
  }).sort({ vigenteDesde: -1 }).lean();

  const porEtiqueta = new Map();
  for (const precio of precios) {
    const key = String(precio.etiquetaId);
    if (!porEtiqueta.has(key)) porEtiqueta.set(key, precio.monto);
  }
  return porEtiqueta;
};

/**
 * @openapi
 * /api/etiquetas:
 *   get:
 *     summary: Listar etiquetas del club
 *     tags: [Etiquetas]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: uso_sistema
 *         in: query
 *         description: Filtrar por identificador de sistema
 *         schema: { type: string }
 *       - name: trash
 *         in: query
 *         description: Mostrar eliminadas
 *         schema: { type: string, enum: ['true'] }
 *     responses:
 *       200:
 *         description: Lista de etiquetas, cada una con `precioVigente` (monto actual, o null si no tiene ningún precio configurado)
 *       500:
 *         description: Error al obtener etiquetas
 */
export const getEtiquetasHandler = async (req, res) => {
  try {
    const { uso_sistema, trash } = req.query;
    const showTrash = trash === 'true';

    const filter = {
      clubId: req.user.clubId,
      active: !showTrash,
    };

    if (uso_sistema) filter.uso_sistema = uso_sistema;

    const etiquetas = await Etiqueta.find(filter).sort({ nombre: 1 }).lean();

    const precioVigentePorEtiqueta = await buildPrecioVigentePorEtiqueta({
      clubId: req.user.clubId,
      etiquetaIds: etiquetas.map((e) => e._id),
      fecha: new Date(),
    });

    const etiquetasConPrecio = etiquetas.map((e) => ({
      ...e,
      precioVigente: precioVigentePorEtiqueta.get(String(e._id)) ?? null,
    }));

    return res.status(200).json(etiquetasConPrecio);
  } catch (error) {
    console.error('Error obteniendo etiquetas:', error);
    return res.status(500).json({ message: 'Error al obtener etiquetas' });
  }
};

export default getEtiquetasHandler;
