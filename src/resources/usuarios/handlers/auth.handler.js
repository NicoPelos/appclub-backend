import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Socio from '../../socios/models/Socio.js';
import VinculoFamiliar from '../../vinculos/models/VinculoFamiliar.js';
import Notification from '../../notificaciones/models/Notification.js';
import bcrypt from 'bcryptjs';
import tokenService from '../../../services/tokenBlacklistService.js';
import { issueRefreshToken, claimRefreshToken, revokeRefreshToken } from '../../../services/refreshTokenService.js';
import { getPermisosUsuario } from '../../../services/permisosCache.js';
import { esClubActivo } from '../../../services/clubActivoCache.js';
import { generarPasswordTemporal } from '../../../services/generarPasswordTemporal.service.js';
import {
  obtenerRolIdsPorNombres,
  obtenerRolIdsPorSlugs,
  obtenerSlugsPorRolIds,
} from '../../roles/services/resolverRoles.service.js';

// El access token vive poco (antes eran 8h fijas sin renovación, así que en
// el uso diario normal ya estaba vencido para la tarde — appcarc-mobile#107)
// porque ahora el refresh token lo renueva solo mientras haya actividad.
const ACCESS_TOKEN_TTL = '1h';

// Un body con objetos o operadores de Mongo ({ $ne: null }) llegaría directo a
// los filtros y a bcrypt (appcarc-backend#245): solo se aceptan strings no vacíos.
const esTexto = (v) => typeof v === 'string' && v.length > 0;

/** Arma la respuesta final de auth (token + refreshToken + user + permisos +
 * socio) para un `User` ya autenticado, con el `socioId` del perfil activo
 * (el propio o uno vinculado — ver VinculoFamiliar). El access token siempre
 * tiene la misma forma que hoy ({id, email, roles, clubId, socioId}), así el
 * resto del backend (protect, authorize, etc.) no necesita saber nada sobre
 * perfiles vinculados. El refresh token lleva el mismo roles/clubId/socioId
 * como payload propio, para poder reemitir el access token sin perder el
 * perfil activo cuando se renueve. */
const buildAuthResponse = async (user, { socioId = user.socioId || null, rolesSlugs = null } = {}) => {
  const finalRolesSlugs = rolesSlugs ?? await obtenerSlugsPorRolIds({ clubId: user.clubId, rolIds: user.roles });
  const token = jwt.sign(
    { id: user._id, email: user.email, roles: finalRolesSlugs, clubId: user.clubId, socioId },
    process.env.JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL },
  );
  const refreshToken = await issueRefreshToken(user._id, { email: user.email, roles: finalRolesSlugs, clubId: user.clubId, socioId });
  const socio = socioId ? await Socio.findById(socioId).lean() : null;
  const permisos = await getPermisosUsuario(user.clubId, finalRolesSlugs);

  return {
    token,
    refreshToken,
    user: {
      id: user._id,
      email: user.email,
      nombre: socio?.nombre || user.nombre,
      roles: finalRolesSlugs,
      clubId: user.clubId,
      socioId: socioId || null,
      mustChangePassword: !!user.mustChangePassword,
    },
    permisos,
    socio: socio ? {
      id: socio._id,
      nombre: socio.nombre,
      apellido: socio.apellido,
      fotoPerfil: socio.fotoPerfil,
      redesSociales: socio.redesSociales,
    } : null,
  };
};

/** Perfiles a los que puede entrar un User: el propio (si es socio) más los
 * hijos vinculados (ver issue #28 — vinculación padre-hijo). */
const obtenerPerfilesDisponibles = async (user) => {
  const perfiles = [];

  if (user.socioId) {
    const socio = await Socio.findById(user.socioId).select('nombre apellido fotoPerfil').lean();
    if (socio) {
      perfiles.push({ socioId: String(socio._id), tipo: 'propio', nombre: socio.nombre, apellido: socio.apellido, fotoPerfil: socio.fotoPerfil });
    }
  }

  const vinculos = await VinculoFamiliar.find({ clubId: user.clubId, padreUserId: user._id, active: true })
    .populate('hijoSocioId', 'nombre apellido fotoPerfil')
    .lean();

  for (const v of vinculos) {
    if (!v.hijoSocioId) continue;
    perfiles.push({
      socioId: String(v.hijoSocioId._id),
      tipo: 'vinculado',
      nombre: v.hijoSocioId.nombre,
      apellido: v.hijoSocioId.apellido,
      fotoPerfil: v.hijoSocioId.fotoPerfil,
    });
  }

  if (perfiles.length > 0) {
    const counts = await Notification.aggregate([
      { $match: { userId: user._id, clubId: user.clubId, read: false, socioId: { $in: perfiles.map((p) => p.socioId) } } },
      { $group: { _id: '$socioId', count: { $sum: 1 } } },
    ]);
    const countPorSocio = new Map(counts.map((c) => [c._id, c.count]));
    for (const p of perfiles) {
      p.notificacionesNoLeidas = countPorSocio.get(p.socioId) ?? 0;
    }
  }

  return perfiles;
};

/** Punto único de salida para cualquier login ya autenticado (email/password
 * o Google): si hay más de un perfil accesible, pide elegir en vez de emitir
 * el token final directo — usado tanto por `login` como por
 * `buildGoogleLoginResponse`, que antes armaba su propio token a mano y por
 * eso nunca ofrecía el selector de perfiles a quienes entran con Google. */
const resolveLoginResponse = async (user) => {
  const perfiles = await obtenerPerfilesDisponibles(user);

  if (perfiles.length > 1) {
    const selectToken = jwt.sign(
      { id: user._id, clubId: user.clubId, type: 'profile-select' },
      process.env.JWT_SECRET,
      { expiresIn: '10m' },
    );
    return { requiresProfileSelection: true, selectToken, perfiles };
  }

  const unico = perfiles[0];
  return buildAuthResponse(user, unico
    ? { socioId: unico.socioId, rolesSlugs: unico.tipo === 'vinculado' ? ['socio'] : null }
    : { socioId: null });
};

const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

const buildGoogleLoginResponse = async (payload, clubId) => {
  const email = String(payload.email || '').trim().toLowerCase();
  const { picture, sub: googleId, email_verified } = payload;

  if (email_verified === false) {
    const error = new Error('Email de Google no verificado.');
    error.code = 'EMAIL_NOT_VERIFIED';
    throw error;
  }

  if (!clubId) {
    const error = new Error('clubId es requerido');
    error.code = 'MISSING_CLUB_ID';
    throw error;
  }

  let user = await User.findOne({ email, clubId });

  if (!user) {
    const socio = await Socio.findOne({ correoElectronico: email, clubId, active: true });

    if (!socio) {
      const error = new Error('Tu email no está registrado como socio en ningún club. Contacta al administrador.');
      error.code = 'NOT_SOCIO';
      throw error;
    }

    const randomPassword = generarPasswordTemporal();
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(randomPassword, salt);
    const rolesSocio = await obtenerRolIdsPorSlugs({ clubId, slugs: ['socio'] });

    user = new User({
      email,
      password: hashedPassword,
      nombre: socio.nombre,
      roles: rolesSocio,
      clubId,
      socioId: socio._id.toString(),
      active: true,
      googleId,
    });

    await user.save();
  }

  if (!user.active) {
    const error = new Error('Usuario desactivado');
    error.code = 'USER_DISABLED';
    throw error;
  }

  // appcarc-backend#169: suspender un club no bloqueaba el login por Google.
  if (!(await esClubActivo(user.clubId))) {
    const error = new Error('El club está suspendido');
    error.code = 'CLUB_SUSPENDED';
    throw error;
  }

  if (!user.googleId) {
    user.googleId = googleId;
    await user.save();
  }

  const socio = user.socioId ? await Socio.findById(user.socioId) : null;

  // Guardar foto de Google en el socio si no tiene una propia
  if (socio && picture && !socio.fotoPerfil) {
    socio.fotoPerfil = picture;
    await socio.save();
  }

  return resolveLoginResponse(user);
};

const VALID_ROLES = ['admin', 'autoridad', 'secretaria', 'profesor', 'palestrero', 'limpieza', 'arreglos', 'colaborador', 'socio'];

export const register = async (req, res) => {
  const { password, dni, nombre, role } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;
  // El club es el del staff autenticado, nunca el que venga en el body — ver
  // appcarc-backend#209: tomar clubId del body permitía a cualquier staff
  // con usuarios:write crear (o pisar el vínculo de) una cuenta en OTRO
  // club, rompiendo el aislamiento multi-tenant.
  const clubId = req.user.clubId;

  if (role && !VALID_ROLES.includes(role)) {
    return res.status(400).json({ message: `Rol inválido. Roles permitidos: ${VALID_ROLES.join(', ')}` });
  }

  try {
    const existingUser = await User.findOne({ email, clubId });
    if (existingUser) return res.status(400).json({ message: 'El usuario ya existe con este email.' });

    let mustChangePassword = false;
    let hashedPassword;
    if (!password && dni) {
      mustChangePassword = true;
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(dni, salt);
    } else {
      const salt = await bcrypt.genSalt(10);
      hashedPassword = await bcrypt.hash(password, salt);
    }

    const socio = await Socio.findOne({ correoElectronico: email, clubId, active: true });

    const rolesIds = await obtenerRolIdsPorNombres({ clubId, nombres: [role || 'secretaria'] });
    if (!rolesIds.length) {
      return res.status(400).json({ message: `El rol "${role || 'secretaria'}" no existe para este club.` });
    }

    const socioId = socio?._id?.toString();
    const user = new User({
      email,
      password: hashedPassword,
      nombre: nombre || socio?.nombre,
      roles: rolesIds,
      clubId,
      ...(socioId ? { socioId } : {}),
      mustChangePassword,
    });
    await user.save();

    const rolesSlugs = await obtenerSlugsPorRolIds({ clubId: user.clubId, rolIds: user.roles });
    const token = jwt.sign(
      { id: user._id, email: user.email, roles: rolesSlugs, clubId: user.clubId, socioId: user.socioId || null },
      process.env.JWT_SECRET,
      { expiresIn: '8h' },
    );
    const permisos = await getPermisosUsuario(user.clubId, rolesSlugs);

    res.status(201).json({
      token,
      user: {
        id: user._id,
        email: user.email,
        nombre: user.nombre,
        roles: rolesSlugs,
        clubId: user.clubId,
        socioId: user.socioId || null,
        mustChangePassword: user.mustChangePassword,
      },
      permisos,
    });
  } catch (error) {
    console.error('Error en el registro de usuario:', error);
    res.status(500).json({ message: 'Error en el servidor al registrar usuario.' });
  }
};

export const googleLogin = async (req, res) => {
  const { idToken, clubId } = req.body;

  try {
    const ticket = await client.verifyIdToken({ idToken, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const response = await buildGoogleLoginResponse(payload, clubId);

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error en Google Login:', error);
    if (error.code === 'EMAIL_NOT_VERIFIED') {
      return res.status(400).json({ message: error.message });
    }
    if (error.code === 'MISSING_CLUB_ID') {
      return res.status(400).json({ message: error.message });
    }
    if (error.code === 'NOT_SOCIO') {
      return res.status(403).json({ message: error.message });
    }
    if (error.code === 'USER_DISABLED' || error.code === 'CLUB_SUSPENDED') {
      return res.status(403).json({ message: error.message });
    }
    return res.status(401).json({ message: 'Autenticación de Google fallida' });
  }
};

export const googleCallback = async (req, res) => {
  const code = req.query.code;
  const state = req.query.state;
  const clubId = state || req.query.clubId || process.env.DEFAULT_CLUB_ID;

  if (!code) {
    return res.status(400).json({ message: 'Code de Google es requerido.' });
  }

  try {
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) {
      return res.status(400).json({ message: 'Google no devolvió id_token.' });
    }

    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    const response = await buildGoogleLoginResponse(payload, clubId);

    return res.status(200).json(response);
  } catch (error) {
    console.error('Error en Google OAuth callback:', error);
    return res.status(401).json({ message: 'Autenticación de Google fallida en callback' });
  }
};

export const login = async (req, res) => {
  const { password, clubId } = req.body;
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : req.body.email;
  if (!esTexto(email) || !esTexto(password) || (clubId !== undefined && !esTexto(clubId))) {
    return res.status(400).json({ message: 'Credenciales inválidas.' });
  }
  try {
    // El email no es único entre clubes (ver User.js): antes se tomaba una
    // cuenta arbitraria con findOne({ email }) y, con la misma contraseña
    // inicial (el DNI) en dos clubes, se podía entrar al club equivocado sin
    // aviso (appcarc-backend#200). Ahora se prueban todas las cuentas de ese
    // email, y si más de una coincide se pide elegir el club en vez de adivinar.
    const cuentas = await User.find(clubId ? { email, clubId } : { email });
    const coincidentes = [];
    for (const cuenta of cuentas) {
      if (await bcrypt.compare(password, cuenta.password)) coincidentes.push(cuenta);
    }
    if (coincidentes.length === 0) return res.status(400).json({ message: 'Credenciales inválidas.' });
    if (coincidentes.length > 1) {
      return res.status(409).json({
        message: 'Este email tiene cuentas en más de un club. Indicá el club (clubId) para ingresar.',
        clubIds: coincidentes.map((c) => c.clubId),
      });
    }
    const user = coincidentes[0];
    if (!user.active) return res.status(403).json({ message: 'Usuario desactivado' });
    // appcarc-backend#169: suspender un club no bloqueaba el login.
    if (!(await esClubActivo(user.clubId))) return res.status(403).json({ message: 'El club está suspendido' });

    const response = await resolveLoginResponse(user);
    res.status(200).json(response);
  } catch (error) {
    console.error('Error en el login de usuario:', error);
    res.status(500).json({ message: 'Error en el servidor al iniciar sesión.' });
  }
};

/** Valida que `socioId` sea un perfil accesible para `user` (el propio o un
 * hijo vinculado) y resuelve con qué roles debe entrar. `null` si no tiene
 * acceso a ese perfil. */
const resolverPerfilElegido = async (user, socioId) => {
  const esPropio = user.socioId && String(user.socioId) === String(socioId);
  if (esPropio) return { rolesSlugs: null };

  const vinculo = await VinculoFamiliar.findOne({ clubId: user.clubId, padreUserId: user._id, hijoSocioId: socioId, active: true });
  if (!vinculo) return null;
  return { rolesSlugs: ['socio'] };
};

export const selectProfile = async (req, res) => {
  const { selectToken, socioId } = req.body;
  if (!esTexto(selectToken) || !esTexto(socioId)) {
    return res.status(400).json({ message: 'selectToken y socioId son requeridos.' });
  }

  try {
    let decoded;
    try {
      decoded = jwt.verify(selectToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: 'selectToken inválido o expirado.' });
    }
    if (decoded.type !== 'profile-select') {
      return res.status(401).json({ message: 'selectToken inválido.' });
    }

    const user = await User.findById(decoded.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Usuario no encontrado o desactivado' });

    const perfil = await resolverPerfilElegido(user, socioId);
    if (!perfil) return res.status(403).json({ message: 'No tenés acceso a ese perfil.' });

    const response = await buildAuthResponse(user, { socioId, rolesSlugs: perfil.rolesSlugs });
    res.status(200).json(response);
  } catch (error) {
    console.error('Error seleccionando perfil:', error);
    res.status(500).json({ message: 'Error en el servidor al seleccionar perfil.' });
  }
};

/** Lista los perfiles disponibles del usuario logueado (el propio + hijos
 * vinculados), sin importar cuál esté activo en la sesión actual — para armar
 * un menú de "cambiar de perfil" en cualquier momento, no solo al loguearse. */
export const getProfiles = async (req, res) => {
  try {
    const user = await User.findById(req.user?.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Usuario no encontrado o desactivado' });

    const perfiles = await obtenerPerfilesDisponibles(user);
    res.status(200).json({ perfiles });
  } catch (error) {
    console.error('Error obteniendo perfiles:', error);
    res.status(500).json({ message: 'Error al obtener perfiles' });
  }
};

/** Cambia el perfil activo de una sesión ya logueada, sin pedir contraseña de
 * nuevo — a diferencia de selectProfile (que usa un selectToken de corta
 * duración emitido en el login), acá se usa el token normal ya válido. */
export const switchProfile = async (req, res) => {
  const { socioId } = req.body;
  if (!esTexto(socioId)) return res.status(400).json({ message: 'socioId es requerido.' });

  try {
    const user = await User.findById(req.user?.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Usuario no encontrado o desactivado' });

    const perfil = await resolverPerfilElegido(user, socioId);
    if (!perfil) return res.status(403).json({ message: 'No tenés acceso a ese perfil.' });

    const response = await buildAuthResponse(user, { socioId, rolesSlugs: perfil.rolesSlugs });
    res.status(200).json(response);
  } catch (error) {
    console.error('Error cambiando de perfil:', error);
    res.status(500).json({ message: 'Error en el servidor al cambiar de perfil.' });
  }
};

/**
 * @openapi
 * /api/auth/push-token:
 *   put:
 *     summary: Registrar token de notificaciones push de Expo
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [expoPushToken]
 *             properties:
 *               expoPushToken:
 *                 type: string
 *                 description: Token de Expo Push Notifications (ExponentPushToken[...])
 *     responses:
 *       200:
 *         description: Token registrado correctamente
 *       400:
 *         description: Token inválido o faltante
 *       500:
 *         description: Error al registrar token
 */
export const registerPushToken = async (req, res) => {
  const { expoPushToken } = req.body;

  if (!expoPushToken || typeof expoPushToken !== 'string') {
    return res.status(400).json({ message: 'expoPushToken es requerido' });
  }

  try {
    // Un mismo dispositivo puede loguearse con otra cuenta: el token pasa a
    // ser de quien lo registró último, sin dejar pushes duplicados en la otra
    // (appcarc-backend#249).
    await User.updateMany(
      { expoPushToken, _id: { $ne: req.user?.id } },
      { $set: { expoPushToken: null } },
    );
    await User.findByIdAndUpdate(req.user?.id, { expoPushToken });
    res.status(200).json({ message: 'Token registrado correctamente' });
  } catch (error) {
    console.error('Error registrando push token:', error);
    res.status(500).json({ message: 'Error al registrar push token' });
  }
};

/** Renueva el access token a partir de un refresh token vigente, sin pedir
 * contraseña de nuevo — rota el refresh token en cada uso (se borra el
 * viejo, se emite uno nuevo) para no dejar circulando indefinidamente uno
 * que el dispositivo pudo haber perdido. */
export const refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!esTexto(refreshToken)) return res.status(400).json({ message: 'refreshToken es requerido.' });

  try {
    // Se consume el token antes de validar nada: dos renovaciones concurrentes
    // con el mismo token no pueden emitir dos sesiones (appcarc-backend#248).
    const doc = await claimRefreshToken(refreshToken);
    if (!doc) return res.status(401).json({ message: 'Sesión expirada, iniciá sesión de nuevo.' });

    const user = await User.findById(doc.userId);
    if (!user || !user.active) {
      return res.status(401).json({ message: 'Usuario no encontrado o desactivado' });
    }
    // appcarc-backend#169: el refresh token re-emite el access token sin
    // pasar por protect ni por login — sin este chequeo, un club suspendido
    // seguía renovando sesiones indefinidamente mientras el refresh token
    // siguiera vigente.
    if (!(await esClubActivo(user.clubId))) {
      return res.status(403).json({ message: 'El club está suspendido' });
    }

    // Mismo criterio que protect para el access token: un refresh token
    // emitido antes de un cambio de contraseña no puede seguir renovando
    // sesiones (appcarc-backend#199).
    if (user.passwordChangedAt && doc.createdAt < user.passwordChangedAt) {
      return res.status(401).json({ message: 'Sesión expirada, la contraseña fue cambiada' });
    }

    // Los roles se releen de la base: un cambio o baja de rol tiene que
    // aplicarse en la próxima renovación, no quedar congelado en el payload
    // (appcarc-backend#247). El perfil activo sí se conserva.
    const response = await buildAuthResponse(user, { socioId: doc.payload.socioId });
    res.status(200).json(response);
  } catch (error) {
    console.error('Error renovando sesión:', error);
    res.status(500).json({ message: 'Error en el servidor al renovar la sesión.' });
  }
};

export const logout = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(400).json({ message: 'Falta token' });
    await tokenService.addToken(token);
    if (req.body?.refreshToken) await revokeRefreshToken(req.body.refreshToken);
    if (req.user?.id) await User.findByIdAndUpdate(req.user.id, { expoPushToken: null });
    return res.status(200).json({ message: 'Desconectado correctamente' });
  } catch (error) {
    console.error('Error en logout:', error);
    return res.status(500).json({ message: 'Error en el servidor al desconectar.' });
  }
};

export const changePassword = async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).json({ message: 'newPassword es requerido.' });
  }

  try {
    const user = await User.findById(req.user?.id);
    if (!user) {
      return res.status(404).json({ message: 'Usuario no encontrado.' });
    }

    // Permitir cambio sin currentPassword si el usuario está marcado para cambiar (primer login)
    if (!currentPassword && !user.mustChangePassword) {
      return res.status(400).json({ message: 'currentPassword requerido.' });
    }

    if (currentPassword) {
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({ message: 'Contraseña actual inválida.' });
      }
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.mustChangePassword = false;
    user.passwordChangedAt = new Date();
    await user.save();

    res.status(200).json({ message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    console.error('Error cambiando contraseña:', error);
    res.status(500).json({ message: 'Error en el servidor al cambiar contraseña.' });
  }
};
