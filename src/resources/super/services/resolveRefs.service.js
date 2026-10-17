import Socio from '../../socios/models/Socio.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Plan from '../../planes/models/Plan.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import User from '../../usuarios/models/User.js';

// Solo estos modelos se pueden resolver — evita que /resolve-refs se use para
// leer nombres de colecciones arbitrarias (ej. AuditLog, Club) a partir de un ID.
export const RESOLVERS = {
  Socio: async (ids) => {
    const docs = await Socio.find({ _id: { $in: ids } }, 'nombre apellido').lean();
    return new Map(docs.map((d) => [String(d._id), `${d.nombre} ${d.apellido}`.trim()]));
  },
  Etiqueta: async (ids) => {
    const docs = await Etiqueta.find({ _id: { $in: ids } }, 'nombre').lean();
    return new Map(docs.map((d) => [String(d._id), d.nombre]));
  },
  Plan: async (ids) => {
    const docs = await Plan.find({ _id: { $in: ids } }, 'nombre').lean();
    return new Map(docs.map((d) => [String(d._id), d.nombre]));
  },
  Suscripcion: async (ids) => {
    const docs = await Suscripcion.find({ _id: { $in: ids } })
      .populate('etiquetaId', 'nombre')
      .select('etiquetaId fechaDesde')
      .lean();
    return new Map(docs.map((d) => [String(d._id), `${d.etiquetaId?.nombre ?? 'Suscripción'} (${d.fechaDesde})`]));
  },
  User: async (ids) => {
    const docs = await User.find({ _id: { $in: ids } }, 'nombre email').lean();
    return new Map(docs.map((d) => [String(d._id), d.nombre || d.email]));
  },
};
