import { BusinessError } from './crearPreferenciaCobroMercadoPago.errors.js';
import { crearPreferenciaYGuardarIntent } from './guardarPreferenciaMercadoPago.js';

export { BusinessError };

// A diferencia del cobro manual (que puede resolver el precio vigente en el
// servidor si no viene "amount"), acá se exige un monto concreto por item:
// Mercado Pago necesita saber el total a cobrar ANTES de que exista un cobro
// real, y los items ya vienen con el monto que secretaría ajustó/confirmó en
// Registrar Cobro — no tiene sentido resolver un precio distinto acá.
const normalizeItemParaLink = (item, index, socioId) => {
  const itemSocioId = String(item?.socioId || '').trim();
  if (itemSocioId !== String(socioId)) {
    throw new BusinessError(`El item ${index + 1} no corresponde al socio indicado`);
  }

  const suscripcionId = item?.suscripcionId ? String(item.suscripcionId).trim() : null;
  const cargoPuntualId = item?.cargoPuntualId ? String(item.cargoPuntualId).trim() : null;
  const muroLibrePendiente = Boolean(item?.muroLibrePendiente);

  if (!suscripcionId && !cargoPuntualId && !muroLibrePendiente) {
    throw new BusinessError(`El item ${index + 1} debe indicar suscripcionId, cargoPuntualId o muroLibrePendiente`);
  }

  const amount = Number(item?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BusinessError(`El item ${index + 1} necesita un monto asignado para generar el link de pago`);
  }

  // appcarc-backend#258: dedup igual que en el flujo propio — acá "amount" ya
  // viene fijado por secretaría y no se recalcula a partir de periodos.length,
  // así que un período repetido no duplica el monto cobrado, pero sí queda
  // guardado dos veces en el intent/cobro resultante (reportes, Cuota por
  // período duplicada). Se deduplica para que el registro sea consistente.
  const periodos = Array.isArray(item?.periodos) && item.periodos.length
    ? [...new Set(item.periodos.map(String))]
    : undefined;
  const asistenciaIds = Array.isArray(item?.asistenciaIds) && item.asistenciaIds.length ? item.asistenciaIds.map(String) : undefined;
  const cantidad = item?.cantidad == null ? undefined : Number(item.cantidad);
  // Misma regla que registrarCobro.service.js: sin esto, un cantidad inválido
  // (NaN, 0, negativo) caía en el "|| 1" de más abajo y el link se generaba
  // con un monto que después registrarCobro rechaza (appcarc-backend#188).
  if (muroLibrePendiente && cantidad !== undefined && (!Number.isInteger(cantidad) || cantidad <= 0)) {
    throw new BusinessError(`El item ${index + 1} debe tener una cantidad entera mayor que cero`);
  }

  // BUG appcarc-backend#155: acá se multiplicaba "amount" por la cantidad de
  // períodos/visitas asumiendo que era un importe unitario — pero
  // RegistrarCobroScreen arma "amount" con el MISMO contrato que usa
  // registrarCobro.service.js (Confirmar cobro, comparte los mismos items):
  // para una suscripción, "amount" YA es el total de ese item repartido
  // entre sus períodos, no hay que volver a multiplicarlo (una cuota de
  // $6000 × 8 meses se mandaba como amount=48000, y esto lo convertía en
  // $384.000). Para muro libre en cambio "amount" sí es el importe POR
  // VISITA (ver registrarCobro.service.js, visitAmount se aplica tal cual a
  // cada asistencia) — ahí corresponde multiplicar por la cantidad real de
  // visitas (asistenciaIds, con "cantidad" como fallback legacy). Un cargo
  // puntual es un único ítem, "amount" ya es su total.
  const montoItem = suscripcionId ? amount : amount * (asistenciaIds?.length || cantidad || 1);

  return {
    normalizado: {
      socioId: itemSocioId,
      suscripcionId,
      cargoPuntualId,
      muroLibrePendiente,
      periodos,
      asistenciaIds,
      cantidad,
      amount,
      description: String(item?.description || '').trim(),
    },
    montoItem,
  };
};

export const crearPreferenciaCobroMercadoPago = async ({
  clubId, requestedByUserId, requestedByEmail, socioId, items, description,
}) => {
  if (!clubId) throw new BusinessError('No se pudo determinar el club del usuario', 401);
  if (!socioId) throw new BusinessError('socioId es requerido');
  if (!Array.isArray(items) || !items.length) throw new BusinessError('Elegí al menos un ítem para generar el link de pago');

  const procesados = items.map((item, index) => normalizeItemParaLink(item, index, socioId));
  const normalizedItems = procesados.map((p) => p.normalizado);
  const totalAmount = procesados.reduce((total, p) => total + p.montoItem, 0);

  return crearPreferenciaYGuardarIntent({
    clubId, requestedByUserId, requestedByEmail, primarySocioId: socioId, normalizedItems, totalAmount, description,
  });
};

