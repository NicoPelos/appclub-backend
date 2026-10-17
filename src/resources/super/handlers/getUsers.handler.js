import User from '../../usuarios/models/User.js';
import Socio from '../../socios/models/Socio.js';
import Rol from '../../roles/models/Rol.js';

export const getUsersHandler = async (req, res) => {
  try {
    const { clubId, rol, active, search, page = 1, limit = 50 } = req.query;
    const pageNumber = Math.max(1, parseInt(page) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(limit) || 50));

    const filter = {};
    if (clubId) filter.clubId = clubId;
    // Sin clubId, el rol se busca en todos los clubes: antes resolvía contra
    // clubId undefined y devolvía siempre una lista vacía (appcarc-backend#241).
    if (rol) {
      const rolFilter = clubId ? { clubId, nombre: rol } : { nombre: rol };
      filter.roles = { $in: await Rol.find(rolFilter).distinct('_id') };
    }
    if (active !== undefined) filter.active = active === 'true';

    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      const orClauses = [{ nombre: regex }, { email: regex }];

      // User.socioId es un string suelto (no populate directo) — si el
      // término de búsqueda parece un DNI, resolvemos primero los Socio que
      // matchean (scoped al club si hay uno elegido) y sumamos sus ids al
      // mismo $or (appcarc-superadmin#6).
      if (/^\d+$/.test(search.trim())) {
        const socioFilter = { dni: regex };
        if (clubId) socioFilter.clubId = clubId;
        const socios = await Socio.find(socioFilter).select('_id');
        if (socios.length) orClauses.push({ socioId: { $in: socios.map((s) => String(s._id)) } });
      }

      filter.$or = orClauses;
    }

    const [total, users] = await Promise.all([
      User.countDocuments(filter),
      User.find(filter)
        .select('-password -expoPushToken')
        .populate('roles', 'nombre')
        .sort({ createdAt: -1 })
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .lean(),
    ]);

    const usersConRoles = users.map((u) => ({ ...u, roles: (u.roles || []).map((r) => r.nombre) }));
    res.status(200).json({ page: pageNumber, limit: pageSize, total, users: usersConRoles });
  } catch (error) {
    console.error('Error obteniendo usuarios:', error);
    res.status(500).json({ message: 'Error al obtener usuarios' });
  }
};
