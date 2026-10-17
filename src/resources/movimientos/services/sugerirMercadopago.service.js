import Movimiento from '../models/Movimiento.js';
import { buscarSocioPorPagadorHistorico, coincideConHistorialDelSocio } from './pagadorHistorico.service.js';

// Mismo criterio de ventana que mercadopagoCandidatos.handler.js (±5 días).
const VENTANA_DIAS = 5;
// Tolerancia de redondeo — no se espera diferencia real de monto entre un
// pago y el movimiento que le corresponde.
const TOLERANCIA_MONTO = 1;

/**
 * Motor único de sugerencias (appcarc-backend#274): dado un pago — venga de
 * la API de Mercado Pago, de una fila del reporte "Estado de cuenta", o de
 * una captura leída a mano — devuelve una sugerencia, nunca escribe nada:
 *   - "vincular": hay un Movimiento existente que calca razonablemente.
 *   - "revisar": hay más de un candidato y ninguna señal los desempata.
 *   - "crear": no hay ningún Movimiento existente que calce.
 */
export const sugerirMovimientoParaPago = async ({
  clubId, monto, fecha, payerEmail = '', payerName = '', direccion = 'ingreso',
}) => {
  const type = direccion === 'egreso' ? 'Egreso' : 'Ingreso';
  const fechaRef = new Date(fecha);
  const desde = new Date(fechaRef);
  desde.setDate(desde.getDate() - VENTANA_DIAS);
  const hasta = new Date(fechaRef);
  hasta.setDate(hasta.getDate() + VENTANA_DIAS);

  const candidatos = await Movimiento.find({
    clubId,
    active: true,
    type,
    paymentMethod: { $in: ['Transferencia', 'MercadoPago'] },
    amount: { $gte: monto - TOLERANCIA_MONTO, $lte: monto + TOLERANCIA_MONTO },
    date: { $gte: desde, $lte: hasta },
  }).lean();

  const anotados = await Promise.all(candidatos.map(async (c) => ({
    ...c,
    coincidePagadorHistorico: await coincideConHistorialDelSocio({
      clubId, socioId: c.socioId, payerEmail, payerName,
    }),
    yaTieneVinculos: (c.mercadopagoVinculos ?? []).length > 0,
  })));

  anotados.sort((a, b) => {
    if (a.coincidePagadorHistorico !== b.coincidePagadorHistorico) return a.coincidePagadorHistorico ? -1 : 1;
    if (a.yaTieneVinculos !== b.yaTieneVinculos) return a.yaTieneVinculos ? 1 : -1;
    return Math.abs(new Date(a.date) - fechaRef) - Math.abs(new Date(b.date) - fechaRef);
  });

  if (anotados.length === 0) {
    const socioSugerido = await buscarSocioPorPagadorHistorico({ clubId, payerEmail, payerName });
    return {
      tipo: 'crear',
      datosSugeridos: { monto, fecha, type, payerEmail, payerName, socioSugerido },
    };
  }

  // Inequívoco si es el único candidato, o si el primero tiene coincidencia
  // de pagador histórico y el segundo no (se rompió el empate).
  const inequivoco = anotados.length === 1
    || (anotados[0].coincidePagadorHistorico && !anotados[1].coincidePagadorHistorico);

  return {
    tipo: inequivoco ? 'vincular' : 'revisar',
    candidatos: anotados,
  };
};
