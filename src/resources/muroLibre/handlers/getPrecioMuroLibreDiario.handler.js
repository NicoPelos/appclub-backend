import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import { findPrecioVigenteByUsoSistema, USO_SISTEMA_BY_TIPO } from '../services/registrarMuroLibre.service.js';
import { periodoDeFecha } from '../../../services/fechaArgentina.js';
import { detallePrecioNoVigente, mensajePrecioNoVigente } from '../../../services/precioNoVigente.js';

/**
 * @openapi
 * /api/muro-libre/precio-diario:
 *   get:
 *     summary: Precio vigente sugerido para el pase diario de Muro Libre
 *     tags: [MuroLibre]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: esSocio
 *         in: query
 *         schema: { type: boolean }
 *         description: true para el precio de socio, false para no socio (visitante externo)
 *     responses:
 *       200:
 *         description: >
 *           Monto sugerido. Si no hay precio vigente, monto es null y además
 *           vienen message, code PRECIO_NO_VIGENTE, etiquetaId, etiquetaNombre
 *           y periodo (appcarc-backend#317).
 */
export const getPrecioMuroLibreDiarioHandler = async (req, res) => {
  try {
    const esSocio = req.query.esSocio !== 'false';
    const uso_sistema = USO_SISTEMA_BY_TIPO.diario[esSocio ? 'socio' : 'noSocio'];
    const clubId = req.user?.clubId;
    const now = new Date();
    const precio = await findPrecioVigenteByUsoSistema({ clubId, uso_sistema, date: now });
    if (precio) return res.json({ monto: precio.monto });

    // Sin precio sigue siendo 200 con monto null (lo esperan los clientes),
    // pero dice qué falta para que puedan avisarlo (#317).
    const etiqueta = await Etiqueta.findOne({ clubId, uso_sistema, active: true }).lean();
    const periodo = periodoDeFecha(now);
    res.json({
      monto: null,
      message: mensajePrecioNoVigente({ etiquetaNombre: etiqueta?.nombre, periodo }),
      ...detallePrecioNoVigente({ etiqueta, periodo }),
    });
  } catch (error) {
    console.error('Error buscando precio sugerido de muro libre:', error);
    res.status(500).json({ message: 'Error al buscar el precio sugerido' });
  }
};

export default getPrecioMuroLibreDiarioHandler;
