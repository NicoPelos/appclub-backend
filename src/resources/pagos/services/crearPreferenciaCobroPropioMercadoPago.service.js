import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import Cuota from '../../cuotas/models/Cuota.js';
import CargoPuntual from '../../cargosPuntuales/models/CargoPuntual.js';
import Asistencia from '../../asistencias/models/Asistencia.js';
import Etiqueta from '../../etiquetas/models/Etiqueta.js';
import Evento from '../../eventos/models/Evento.js';
import EventoParticipante from '../../eventos/models/EventoParticipante.js';
import { findPrecioVigente } from '../../cuotas/services/findPrecioVigente.service.js';
import { getSocioIdsAccesibles } from '../../vinculos/services/getSocioIdsAccesibles.service.js';
import { BusinessError } from './crearPreferenciaCobroMercadoPago.errors.js';
import { crearPreferenciaYGuardarIntent } from './guardarPreferenciaMercadoPago.js';
import { avisarPrecioNoVigentePagoOnline } from './avisarPrecioNoVigentePagoOnline.service.js';
import { periodoDeFecha } from '../../../services/fechaArgentina.js';
import { detallePrecioNoVigente, mensajePrecioNoVigenteSocio } from '../../../services/precioNoVigente.js';

const PERIODO_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Sin precio vigente (#317): el socio no puede hacer nada, así que se avisa al
// staff (sin esperar: el aviso no debe demorar ni romper la respuesta) y al
// socio se le explica qué falta.
const precioNoVigenteSocioError = ({ clubId, etiqueta, socioId, periodo }) => {
  avisarPrecioNoVigentePagoOnline({ clubId, etiqueta, socioId, periodo })
    .catch((err) => console.error('Error avisando precio no vigente en pago online:', err.message));
  return new BusinessError(
    mensajePrecioNoVigenteSocio({ etiquetaNombre: etiqueta.nombre, periodo }),
    400,
    detallePrecioNoVigente({ etiqueta, periodo }),
  );
};

// A diferencia de RegistrarCobroScreen (staff), acá el usuario elige QUÉ pagar
// pero nunca CUÁNTO: el monto de cada item se resuelve siempre en el servidor
// (precio vigente / snapshot ya guardado), ignorando cualquier "amount" que
// pudiera venir en el body. Esto evita que alguien manipule el pedido para
// generar un link de pago por menos de lo que realmente debe.
//
// El "socioId" de cada item SÍ viene del cliente (puede ser el propio del
// usuario o uno de sus hijos vinculados), pero se valida contra los perfiles
// realmente accesibles antes de resolver nada — nunca contra lo que el
// cliente diga que es "suyo".
const normalizeItemPropio = async ({ item, index, clubId, socioId, date }) => {
  const suscripcionId = item?.suscripcionId ? String(item.suscripcionId).trim() : null;
  const cargoPuntualId = item?.cargoPuntualId ? String(item.cargoPuntualId).trim() : null;
  const muroLibrePendiente = Boolean(item?.muroLibrePendiente);
  const eventoParticipanteId = item?.eventoParticipanteId ? String(item.eventoParticipanteId).trim() : null;

  const tipos = [suscripcionId, cargoPuntualId, muroLibrePendiente || null, eventoParticipanteId].filter(Boolean);
  if (tipos.length !== 1) {
    throw new BusinessError(`El item ${index + 1} debe indicar exactamente uno de suscripcionId, cargoPuntualId, muroLibrePendiente o eventoParticipanteId`);
  }

  // Autoservicio de pago de eventos (viajes, cursos, ventas puntuales) por
  // Mercado Pago — antes esto no existía ni para staff ni para el socio (ver
  // el mensaje "todavía no soporta cobrar eventos" en RegistrarCobroScreen).
  // El pago real NO pasa por registrarCobro (a diferencia de los demás tipos
  // de este archivo): usa registrarPagoEventoParticipante, que tiene su
  // propio contrato de saldo — ver procesarPagoMercadoPago.service.js.
  if (eventoParticipanteId) {
    const participante = await EventoParticipante.findOne({ _id: eventoParticipanteId, socioId, clubId, active: true }).lean();
    if (!participante) throw new BusinessError('Participante de evento no encontrado', 404);
    if (!['pendiente', 'parcial'].includes(participante.estado)) {
      throw new BusinessError(`Este evento ya está ${participante.estado}`, 409);
    }

    const evento = await Evento.findOne({ _id: participante.eventoId, clubId, active: true }).lean();
    if (!evento) throw new BusinessError('Evento no encontrado', 404);
    if (evento.estado === 'cerrado') {
      throw new BusinessError(`El evento "${evento.nombre}" está cerrado, no se pueden registrar pagos`, 409);
    }

    // Igual que el cargo puntual 'parcial' más abajo: se cobra el SALDO
    // restante y cierra el participante por completo, nunca "otra seña".
    const amount = participante.montoEsperadoSnapshot - (participante.montoPagadoSnapshot || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BusinessError('El evento no tiene un saldo pendiente válido');
    }

    return {
      normalizado: {
        socioId, suscripcionId: null, cargoPuntualId: null, muroLibrePendiente: false,
        eventoId: evento._id, eventoParticipanteId, amount, description: evento.nombre,
      },
      montoItem: amount,
      key: `evento:${eventoParticipanteId}`,
    };
  }

  if (cargoPuntualId) {
    const cargo = await CargoPuntual.findOne({ _id: cargoPuntualId, socioId, clubId, active: true }).lean();
    if (!cargo) throw new BusinessError('Cargo puntual no encontrado', 404);
    if (!['pendiente', 'parcial'].includes(cargo.estado)) {
      throw new BusinessError(`El cargo "${cargo.description}" ya está ${cargo.estado}`, 409);
    }

    // Si ya tiene una seña pagada (estado 'parcial'), se cobra el SALDO
    // restante, no el total de nuevo — igual que acá el socio nunca elige
    // el monto, esto también cierra el cargo por completo al confirmarse
    // (appcarc-backend#168): el autoservicio no ofrece pagar "otra seña".
    const amount = cargo.montoEsperadoSnapshot - (cargo.montoPagadoSnapshot || 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BusinessError('El cargo puntual no tiene un monto válido configurado');
    }

    return {
      normalizado: {
        socioId, suscripcionId: null, cargoPuntualId, muroLibrePendiente: false, amount, description: cargo.description,
      },
      montoItem: amount,
      key: `cargo:${cargoPuntualId}`,
    };
  }

  if (muroLibrePendiente) {
    const pendientes = await Asistencia.find({
      clubId, socioId, tipo: 'muro_libre', tipoPase: 'diario', active: true, estadoPago: 'pendiente',
    }).sort({ fecha: 1 }).lean();

    if (!pendientes.length) throw new BusinessError('No tenés visitas de Muro Libre pendientes de pago', 404);

    // Sin cantidad se paga todo; con cantidad se pagan las visitas más viejas
    // primero, igual que el cobro manual (registrarCobro).
    const cantidad = item?.cantidad == null ? pendientes.length : Number(item.cantidad);
    if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > pendientes.length) {
      throw new BusinessError(`El item ${index + 1} debe indicar entre 1 y ${pendientes.length} visitas`);
    }
    const seleccionadas = pendientes.slice(0, cantidad);

    // Cada visita vale su precio guardado; si se registró sin precio (no había
    // uno vigente ese día), el vigente en la fecha de la visita, igual que el
    // cobro manual. Antes una visita sin precio sumaba 0: el socio pagaba de
    // menos y la visita quedaba igual como pagada (#317).
    const usoSistema = seleccionadas[0].esSocio ? 'muro_libre_diario_socio' : 'muro_libre_diario_no_socio';
    let etiquetaMuro;
    let total = 0;
    const normalizados = [];
    for (const asistencia of seleccionadas) {
      let monto = asistencia.precioSugeridoSnapshot;
      if (monto == null) {
        if (etiquetaMuro === undefined) {
          etiquetaMuro = await Etiqueta.findOne({ clubId, uso_sistema: usoSistema, active: true }).lean();
        }
        if (!etiquetaMuro) throw new BusinessError('No hay una etiqueta de Muro Libre Diario configurada para este club');
        const precio = await findPrecioVigente({ clubId, etiquetaId: etiquetaMuro._id, date: asistencia.fecha });
        monto = precio?.monto ?? null;
      }
      if (!Number.isFinite(monto) || monto < 0) {
        throw precioNoVigenteSocioError({ clubId, etiqueta: etiquetaMuro, socioId, periodo: periodoDeFecha(new Date(asistencia.fecha)) });
      }
      total += monto;
      // Un item por visita, con su id y su precio: al confirmarse el pago,
      // registrarCobro paga exactamente estas visitas y cada una queda con
      // su importe, no con el promedio del total (mismo criterio que
      // cambiarFormaPagoCobro).
      normalizados.push({
        socioId,
        suscripcionId: null,
        cargoPuntualId: null,
        muroLibrePendiente: true,
        asistenciaIds: [String(asistencia._id)],
        amount: monto,
        description: 'Muro Libre — visita pendiente',
      });
    }
    if (total <= 0) {
      throw new BusinessError('Las visitas pendientes no tienen un precio configurado');
    }

    return {
      normalizados,
      montoItem: total,
      key: `murolibre:${socioId}`,
    };
  }

  const periodosCrudos = Array.isArray(item?.periodos) ? item.periodos.map((p) => String(p || '').trim()) : [];
  if (!periodosCrudos.length) throw new BusinessError(`El item ${index + 1} debe indicar al menos un período`);
  const periodoInvalido = periodosCrudos.find((p) => !PERIODO_PATTERN.test(p));
  if (periodoInvalido) throw new BusinessError(`El item ${index + 1} contiene un período inválido`);
  // appcarc-backend#258: sin este dedup, un período repetido en el mismo item
  // (ej. ["2026-09","2026-09"] por un doble tap en el selector del cliente)
  // se cobraba dos veces: montoItem se calculaba con periodos.length SIN
  // deduplicar, multiplicando el precio vigente por una cantidad mayor a la
  // real de meses a pagar.
  const periodos = [...new Set(periodosCrudos)];

  const suscripcion = await Suscripcion.findOne({
    _id: suscripcionId, socioId, clubId, active: true,
  }).lean();
  if (!suscripcion) throw new BusinessError('Suscripción no encontrada', 404);

  const yaPagado = await Cuota.findOne({
    clubId, socioId, suscripcionId, periodo: { $in: periodos }, estado: 'pagada', active: true,
  }).lean();
  if (yaPagado) throw new BusinessError(`El período ${yaPagado.periodo} ya está pagado`, 409);

  const etiquetaId = String(suscripcion.etiquetaId);
  const [precio, etiqueta] = await Promise.all([
    findPrecioVigente({ clubId, etiquetaId, date }),
    // appcarc-backend#261: Etiqueta.findById no filtraba por clubId. La
    // suscripción ya está validada contra este club más arriba, pero si
    // etiquetaId apuntara a una etiqueta de otro club (dato corrupto, o un
    // bug futuro que la deje desincronizada) esto la hubiera traído igual —
    // acá solo se usa para el nombre a mostrar, pero el mismo patrón se
    // repite en otros handlers donde sí podría filtrar datos cross-club.
    Etiqueta.findOne({ _id: etiquetaId, clubId }).lean(),
  ]);

  if (!precio || !Number.isFinite(precio.monto) || precio.monto <= 0) {
    throw precioNoVigenteSocioError({
      clubId, etiqueta: { _id: etiquetaId, nombre: etiqueta?.nombre }, socioId, periodo: periodoDeFecha(date),
    });
  }

  return {
    normalizado: {
      socioId,
      suscripcionId,
      cargoPuntualId: null,
      muroLibrePendiente: false,
      periodos,
      amount: precio.monto,
      description: etiqueta?.nombre || '',
    },
    montoItem: precio.monto * periodos.length,
    key: `suscripcion:${socioId}:${suscripcionId}`,
  };
};

export const crearPreferenciaCobroPropioMercadoPago = async ({
  clubId, requestedByUserId, requestedByEmail, items,
}) => {
  if (!clubId) throw new BusinessError('No se pudo determinar el club del usuario', 401);
  if (!requestedByUserId) throw new BusinessError('No se pudo determinar el usuario', 401);
  if (!Array.isArray(items) || !items.length) throw new BusinessError('Elegí al menos un ítem para generar el link de pago');

  const { ownSocioId, accessibleIds } = await getSocioIdsAccesibles({ clubId, userId: requestedByUserId });
  if (!accessibleIds.size) throw new BusinessError('No se pudo determinar el socio', 401);

  const date = new Date();
  const procesados = [];
  for (let index = 0; index < items.length; index += 1) {
    const socioId = String(items[index]?.socioId || '').trim();
    if (!accessibleIds.has(socioId)) {
      throw new BusinessError(`El item ${index + 1} no corresponde a un perfil accesible`, 403);
    }

    procesados.push(await normalizeItemPropio({
      item: items[index], index, clubId, socioId, date,
    }));
  }

  const claveRepetida = procesados.find((p, index) => procesados.findIndex((q) => q.key === p.key) !== index);
  if (claveRepetida) throw new BusinessError('El pedido incluye un ítem duplicado');

  const normalizedItems = procesados.flatMap((p) => p.normalizados ?? [p.normalizado]);
  const totalAmount = procesados.reduce((total, p) => total + p.montoItem, 0);

  return crearPreferenciaYGuardarIntent({
    clubId,
    requestedByUserId,
    requestedByEmail,
    primarySocioId: ownSocioId ?? normalizedItems[0].socioId,
    normalizedItems,
    totalAmount,
    description: '',
    payerEmail: requestedByEmail,
  });
};

export { BusinessError };
