import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Socio from '../models/Socio.js';
import Cuota from '../../cuotas/models/Cuota.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import { periodoDeFecha } from '../../../services/fechaArgentina.js';

const QR_TYPE = 'socio_qr';

class BusinessError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
  }
}

const ensureJwtSecret = () => {
  if (!process.env.JWT_SECRET) {
    throw new BusinessError('JWT_SECRET no está definido en el backend', 500);
  }
};

export const generateSocioQrToken = ({ clubId, socioId }) => {
  ensureJwtSecret();
  return jwt.sign({ clubId, socioId, type: QR_TYPE }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    expiresIn: '30d',
  });
};

export const decodeSocioQrToken = (token) => {
  ensureJwtSecret();

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (!payload || payload.type !== QR_TYPE) {
      throw new BusinessError('Token QR inválido', 400);
    }

    return payload;
  } catch (error) {
    if (error instanceof BusinessError) throw error;
    throw new BusinessError('Token QR no válido', 400);
  }
};

export const findActiveSocioById = async (id, clubId) => {
  if (!mongoose.isValidObjectId(id)) return null;
  return Socio.findOne({ _id: id, clubId, active: true });
};

export const findActiveSocioByDni = async (dni, clubId) => {
  const normalizedDni = String(dni || '').trim();
  if (!normalizedDni) return null;
  return Socio.findOne({ dni: normalizedDni, clubId, active: true });
};

export const resolveSocioFromQrToken = async (token, clubId) => {
  const payload = decodeSocioQrToken(token);

  if (payload.clubId !== clubId) {
    throw new BusinessError('El QR no pertenece a este club', 403);
  }

  const socio = await findActiveSocioById(payload.socioId, clubId);
  if (!socio) {
    throw new BusinessError('Socio no encontrado o inactivo', 404);
  }

  return socio;
};

export const resolveSocioFromQrTokenOrDni = async ({
  token,
  dni,
  clubId,
  missingMessage = 'Se requiere token QR o DNI',
  dniNotFoundMessage = 'Socio no encontrado por DNI',
}) => {
  if (token) {
    return {
      socio: await resolveSocioFromQrToken(token, clubId),
      method: 'QR',
    };
  }

  if (dni) {
    const socio = await findActiveSocioByDni(dni, clubId);
    if (!socio) {
      throw new BusinessError(dniNotFoundMessage, 404);
    }

    return { socio, method: 'DNI' };
  }

  throw new BusinessError(missingMessage, 400);
};

export const getSocioDebtSummary = async (socioId, clubId) => {
  const [summary] = await Cuota.aggregate([
    {
      $match: {
        clubId,
        socioId: new mongoose.Types.ObjectId(socioId),
        active: true,
        estado: 'pendiente',
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalAmount: { $sum: '$montoEsperadoSnapshot' },
      },
    },
  ]);

  return {
    pendingCount: summary?.count ?? 0,
    pendingAmount: summary?.totalAmount ?? 0,
  };
};

export const getLastMuroLibre = async (socioId, clubId) => {
  if (!mongoose.isValidObjectId(socioId)) return null;
  return Asistencia.findOne({ clubId, socioId, tipo: 'muro_libre', active: true }).sort({ fecha: -1 });
};

// Período en huso argentino, no en el de la hora local del servidor: a fin de
// mes el servidor en UTC ya está en el mes siguiente (appcarc-backend#233).
const periodoActual = () => periodoDeFecha(new Date());

export const getPaseMuroLibreVigente = async (socioId, clubId) => {
  const periodo = periodoActual();

  const etiquetaMensual = await Etiqueta.findOne({
    clubId,
    uso_sistema: 'muro_libre_mensual_socio',
    active: true,
  }).lean();

  // fechaDesde <= período actual: un pase mensual programado para un mes
  // futuro (ej. "desde octubre") todavía no cuenta como pase activo — si no,
  // bloquearía los check-ins diarios de hoy.
  const suscripcion = etiquetaMensual && await Suscripcion.findOne({
    clubId,
    socioId,
    etiquetaId: etiquetaMensual._id,
    active: true,
    fechaDesde: { $lte: periodo },
  }).lean();

  if (!suscripcion) {
    return { suscripto: false, vigente: null, periodo };
  }

  const cuota = await Cuota.findOne({
    clubId,
    socioId,
    etiquetaId: etiquetaMensual._id,
    periodo,
    estado: 'pagada',
    active: true,
  }).lean();

  return { suscripto: true, vigente: Boolean(cuota), periodo };
};

export const buildSocioVerificationPayload = async (socio) => {
  const [debtSummary, lastMuroLibre, paseMuroLibre] = await Promise.all([
    getSocioDebtSummary(socio._id, socio.clubId),
    getLastMuroLibre(socio._id, socio.clubId),
    getPaseMuroLibreVigente(socio._id, socio.clubId),
  ]);

  return {
    socio,
    debtSummary,
    lastMuroLibre,
    paseMuroLibre,
  };
};

export { BusinessError };
