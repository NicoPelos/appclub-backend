import jwt from 'jsonwebtoken';
import tokenService from '../services/tokenBlacklistService.js';
import User from '../resources/usuarios/models/User.js';
import VinculoFamiliar from '../resources/vinculos/models/VinculoFamiliar.js';
import { tienePermiso } from '../services/permisosCache.js';
import { esClubActivo } from '../services/clubActivoCache.js';
import { getSocioIdsAccesibles } from '../resources/vinculos/services/getSocioIdsAccesibles.service.js';

export const protect = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'No autorizado, falta token' });
  }

  if (await tokenService.hasToken(token)) {
    return res.status(401).json({ message: 'Token inválido (desconectado)' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select('passwordChangedAt active socioId').lean();
    if (!user || !user.active) {
      return res.status(401).json({ message: 'Usuario no encontrado o desactivado' });
    }
    if (user.passwordChangedAt && decoded.iat * 1000 < user.passwordChangedAt.getTime()) {
      return res.status(401).json({ message: 'Sesión expirada, la contraseña fue cambiada' });
    }

    // appcarc-backend#169: un club suspendido no bloqueaba nada — solo
    // cambiaba un campo decorativo. superadmin (sin clubId "real" de club de
    // datos) queda afuera de este chequeo.
    if (!decoded.roles?.includes('superadmin') && !(await esClubActivo(decoded.clubId))) {
      return res.status(403).json({ message: 'El club está suspendido' });
    }

    // El JWT es stateless y dura 8h: si el socioId activo no es el propio del
    // User, está actuando "como" un perfil vinculado (switchProfile, ver
    // buildAuthResponse en auth.handler.js) y hay que revalidar en cada
    // request que ese VinculoFamiliar siga vigente — si no, anular un vínculo
    // no corta el acceso ya emitido hasta que expire el token (appcarc-backend#71).
    if (decoded.socioId && decoded.socioId !== String(user.socioId ?? '')) {
      const vinculoVigente = await VinculoFamiliar.exists({
        clubId: decoded.clubId,
        padreUserId: decoded.id,
        hijoSocioId: decoded.socioId,
        active: true,
      });
      if (!vinculoVigente) {
        return res.status(401).json({ message: 'El vínculo con este perfil ya no está vigente' });
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ message: 'Token no válido' });
  }
};

// protectSuper — solo accesible para usuarios con rol superadmin
export const protectSuper = [
  protect,
  (req, res, next) => {
    if (!req.user?.roles?.includes('superadmin')) {
      return res.status(403).json({ message: 'Acceso restringido al superadmin' });
    }
    next();
  },
];

// El mismo chequeo que hace authorize(), para un handler que no bloquea sino
// que cambia lo que devuelve según el permiso (ej. getSocioDeuda, #285).
// superadmin pasa siempre.
export const usuarioTienePermiso = async (user, permiso) => {
  const userRoles = user?.roles ?? [];
  if (userRoles.includes('superadmin')) return true;
  return tienePermiso(user?.clubId, userRoles, permiso);
};

// authorize('socios:write') — verifica permiso contra los roles del usuario en BD
export const authorize = (permiso) => {
  return async (req, res, next) => {
    try {
      const ok = await usuarioTienePermiso(req.user, permiso);
      if (!ok) {
        return res.status(403).json({ message: 'No tenés permiso para esta acción' });
      }
      next();
    } catch (error) {
      console.error('[authorize] Error verificando permisos:', error.message);
      return res.status(500).json({ message: 'Error verificando permisos' });
    }
  };
};

// authorizeSelfSocioOr('socios:write') — deja pasar si el actor es un socio operando
// sobre su propio registro (req.params.id === req.user.socioId), o si tiene el permiso
// indicado (staff/admin). Para acciones de "mi propio perfil" que usan una ruta con :id
// en vez de /me, donde el chequeo genérico de authorize() bloquearía al socio por completo.
export const authorizeSelfSocioOr = (permiso) => {
  return async (req, res, next) => {
    if (req.user?.socioId && req.user.socioId === req.params.id) return next();
    return authorize(permiso)(req, res, next);
  };
};

// authorizeSelfSocioQueryOr('escuelita:read') — igual que authorizeSelfSocioOr,
// pero para rutas de listado donde el id del socio viene por query (?socioId=)
// en vez de por :id. Solo deja pasar sin el permiso cuando el query trae
// exactamente el propio socioId — así un socio puede consultar su propio
// estado sin heredar el permiso de listar a todos los socios.
export const authorizeSelfSocioQueryOr = (permiso) => {
  return async (req, res, next) => {
    if (req.user?.socioId && req.query?.socioId && req.user.socioId === req.query.socioId) return next();
    return authorize(permiso)(req, res, next);
  };
};

// authorizeSelfYVinculadosOr('cobros:read') — deja pasar sin el permiso de staff
// cuando la ruta NO pide un socioId puntual por query (listado "de todos los
// míos"): en ese caso se resuelve el propio socio del usuario + sus hijos
// vinculados (ver getSocioIdsAccesibles) y se guarda en req.accessibleSocioIds
// para que el handler filtre con eso, sin volver a golpear la base. Si el
// query SÍ trae un socioId puntual (consulta de staff sobre un socio
// cualquiera), no aplica este atajo y cae al chequeo de permiso normal.
export const authorizeSelfYVinculadosOr = (permiso) => {
  return async (req, res, next) => {
    if (!req.query?.socioId && req.user?.id) {
      const { accessibleIds } = await getSocioIdsAccesibles({ clubId: req.user.clubId, userId: req.user.id });
      if (accessibleIds.size > 0) {
        req.accessibleSocioIds = accessibleIds;
        return next();
      }
    }
    return authorize(permiso)(req, res, next);
  };
};

// authorizeAny([permisoA, permisoB]) — deja pasar si el usuario tiene CUALQUIERA
// de los permisos indicados. Para rutas donde staff y "el propio socio" comparten
// el mismo endpoint pero con permisos distintos (ver muroLibre:checkin_propio /
// escuelita:checkin_propio, appCARC-mobile#60).
export const authorizeAny = (permisos) => {
  return async (req, res, next) => {
    try {
      const userRoles = req.user.roles ?? [];
      if (userRoles.includes('superadmin')) return next();

      const clubId = req.user.clubId;
      for (const permiso of permisos) {
        if (await tienePermiso(clubId, userRoles, permiso)) return next();
      }
      return res.status(403).json({ message: 'No tenés permiso para esta acción' });
    } catch (error) {
      console.error('[authorizeAny] Error verificando permisos:', error.message);
      return res.status(500).json({ message: 'Error verificando permisos' });
    }
  };
};

// authorizeSelfPadreQueryOr('socios:read') — igual que authorizeSelfSocioQueryOr
// pero para tutores: deja pasar sin el permiso de staff cuando ?padreUserId=
// coincide con el propio usuario logueado (para que un tutor liste sus propios
// vínculos familiares sin heredar socios:read).
export const authorizeSelfPadreQueryOr = (permiso) => {
  return async (req, res, next) => {
    if (req.query?.padreUserId && req.query.padreUserId === req.user?.id) return next();
    return authorize(permiso)(req, res, next);
  };
};