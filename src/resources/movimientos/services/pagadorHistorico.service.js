import Movimiento from '../models/Movimiento.js';

// Escapar para meter texto arbitrario en un $regex sin que termine siendo
// interpretado como patrón (ej. un nombre con paréntesis o puntos).
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalizar = (s) => (s ?? '').trim();

const condicionesPagador = ({ payerEmail, payerName }) => {
  const email = normalizar(payerEmail);
  const name = normalizar(payerName);
  const or = [];
  if (email) or.push({ 'mercadopagoVinculos.payerEmail': { $regex: `^${escapeRegex(email)}$`, $options: 'i' } });
  if (name) or.push({ 'mercadopagoVinculos.payerName': { $regex: `^${escapeRegex(name)}$`, $options: 'i' } });
  return or;
};

/**
 * Un socio puede tener a otra persona pagando siempre por él (ej. un padre
 * paga la cuota del hijo) — se busca en el historial de vínculos ya
 * guardados si ese email/nombre ya pagó antes por ESTE socio puntual, sin
 * agregar ningún dato nuevo (appcarc-backend#274, opción 4).
 */
export const coincideConHistorialDelSocio = async ({ clubId, socioId, payerEmail, payerName }) => {
  if (!socioId) return false;
  const or = condicionesPagador({ payerEmail, payerName });
  if (or.length === 0) return false;

  const existe = await Movimiento.exists({ clubId, active: true, socioId, $or: or });
  return Boolean(existe);
};

/**
 * Para el caso de "crear un movimiento nuevo" (no hay ningún Movimiento
 * existente que calce): si este email/nombre ya pagó antes por algún socio,
 * se sugiere ese socio para prellenar el alta — el pagador no tiene que
 * coincidir con el nombre del socio.
 */
export const buscarSocioPorPagadorHistorico = async ({ clubId, payerEmail, payerName }) => {
  const or = condicionesPagador({ payerEmail, payerName });
  if (or.length === 0) return null;

  const matches = await Movimiento
    .find({ clubId, active: true, socioId: { $ne: null }, $or: or })
    .select('socioId socioNombre')
    .lean();
  if (matches.length === 0) return null;

  const conteoPorSocio = new Map();
  for (const m of matches) {
    const key = String(m.socioId);
    conteoPorSocio.set(key, (conteoPorSocio.get(key) ?? 0) + 1);
  }
  const [socioIdMasFrecuente] = [...conteoPorSocio.entries()].sort((a, b) => b[1] - a[1])[0];
  const ejemplo = matches.find((m) => String(m.socioId) === socioIdMasFrecuente);
  return { socioId: ejemplo.socioId, socioNombre: ejemplo.socioNombre };
};
