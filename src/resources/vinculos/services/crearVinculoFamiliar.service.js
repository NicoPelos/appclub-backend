import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../../usuarios/models/User.js';
import Socio from '../../socios/models/Socio.js';
import VinculoFamiliar from '../models/VinculoFamiliar.js';
import { syncSocioUserFromSocio } from '../../usuarios/services/userSync.js';
import { obtenerRolIdsPorSlugs } from '../../roles/services/resolverRoles.service.js';
import { generarPasswordTemporal } from '../../../services/generarPasswordTemporal.service.js';

import { BusinessError } from './businessError.js';

// Devuelve { user, passwordTemporal } — passwordTemporal solo viene seteado
// cuando se creó una cuenta nueva en este llamado, para que quien está
// vinculando pueda comunicársela al tutor (no hay ningún otro canal: no es
// socio, no tiene DNI conocido, y el sistema no manda emails de bienvenida).
const exigirActivo = (user) => {
  if (!user.active) throw new BusinessError('La cuenta del tutor está desactivada', 400);
  return user;
};

// Una cuenta de tutor desactivada no puede quedar vinculada: un vínculo
// activo le daría acceso a los datos del menor (appcarc-backend#254).
const resolverPadre = async ({ clubId, padreUserId, padreSocioId, padreEmail, padreNombre, actor, session }) => {
  if (padreUserId) {
    const user = await User.findOne({ _id: padreUserId, clubId, active: true }).session(session);
    if (!user) throw new BusinessError('El usuario tutor indicado no existe o pertenece a otro club', 404);
    return { user, passwordTemporal: null };
  }

  if (padreSocioId) {
    const socioPadre = await Socio.findOne({ _id: padreSocioId, clubId, active: true }).session(session).lean();
    if (!socioPadre) throw new BusinessError('El socio tutor indicado no existe o pertenece a otro club', 404);

    const existente = await User.findOne({ socioId: padreSocioId, clubId }).session(session);
    if (existente) return { user: exigirActivo(existente), passwordTemporal: null };

    const creado = await syncSocioUserFromSocio(socioPadre, { session });
    if (!creado) {
      throw new BusinessError('Ese socio no tiene email y DNI cargados: no se le puede crear una cuenta propia', 400);
    }
    // syncSocioUserFromSocio usa el DNI como contraseña inicial — mismo dato
    // que ya se le pide a cualquier socio para su primer login.
    return { user: exigirActivo(creado), passwordTemporal: socioPadre.dni };
  }

  const email = String(padreEmail || '').trim().toLowerCase();
  const nombre = String(padreNombre || '').trim();
  if (!email) throw new BusinessError('Indicá padreUserId, padreSocioId o padreEmail', 400);

  const existente = await User.findOne({ email, clubId }).session(session);
  if (existente) return { user: exigirActivo(existente), passwordTemporal: null };

  if (!nombre) throw new BusinessError('padreNombre es requerido para crear una cuenta de tutor nueva', 400);

  const passwordTemporal = generarPasswordTemporal();
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(passwordTemporal, salt);
  const rolesSocio = await obtenerRolIdsPorSlugs({ clubId, slugs: ['socio'] });

  const nuevo = new User({
    email,
    password: hashedPassword,
    nombre,
    roles: rolesSocio,
    clubId,
    active: true,
    mustChangePassword: true,
    createdBy: actor,
    updatedBy: actor,
  });
  await nuevo.save({ session });
  return { user: nuevo, passwordTemporal };
};

export const crearVinculoFamiliar = async ({ clubId, user: actorUser, hijoSocioId, body }) => {
  const actor = actorUser?.email || actorUser?.id;

  // La cuenta de tutor (cuando se crea nueva vía padreEmail) y el vínculo se
  // crean atómicamente: si el vinculo.save() falla (ej. carrera con otra
  // request que creó el mismo vínculo en el medio, choca contra el índice
  // único), no puede quedar una cuenta de User huérfana con contraseña
  // temporal ya generada (appcarc-backend#72).
  const session = await mongoose.startSession();
  try {
    const hijo = await Socio.findOne({ _id: hijoSocioId, clubId, active: true }).session(session).lean();
    if (!hijo) throw new BusinessError('El socio hijo no existe o pertenece a otro club', 404);

    let vinculo, padre, passwordTemporal;

    await session.withTransaction(async () => {
      ({ user: padre, passwordTemporal } = await resolverPadre({
        clubId,
        padreUserId: body?.padreUserId,
        padreSocioId: body?.padreSocioId,
        padreEmail: body?.padreEmail,
        padreNombre: body?.padreNombre,
        actor,
        session,
      }));

      if (padre.socioId && String(padre.socioId) === String(hijoSocioId)) {
        throw new BusinessError('Un socio no puede ser su propio tutor', 400);
      }

      const existente = await VinculoFamiliar.findOne({ clubId, padreUserId: padre._id, hijoSocioId, active: true }).session(session);
      if (existente) throw new BusinessError('Ese vínculo ya existe', 409);

      vinculo = new VinculoFamiliar({
        clubId,
        padreUserId: padre._id,
        hijoSocioId,
        createdBy: actor,
        updatedBy: actor,
      });

      try {
        await vinculo.save({ session });
      } catch (err) {
        if (err.code === 11000) throw new BusinessError('Ese vínculo ya existe', 409);
        throw err;
      }
    });

    return { vinculo, padre, passwordTemporal };
  } finally {
    session.endSession();
  }
};

