// Argentina no tiene horario de verano (siempre UTC-3). Este módulo centraliza
// el cálculo de período/día/semana "en términos de Argentina" a partir de
// una fecha arbitraria — no solo "ahora" — para que un check-in cargado con
// fecha pasada (ver appCARC-mobile#18) calcule su período de cuota, límite
// semanal y duplicado-del-día contra ESA fecha, no contra la fecha real del
// servidor. Antes esta cuenta vivía duplicada (y a medias) en
// checkinEscuelita.handler.js y registrarMuroLibre.service.js.

export const ARG_OFFSET_MS = -3 * 60 * 60 * 1000;

// Ventana de gracia para pagar la cuota del mes en curso antes de "reclamarla"
// (advertencias de check-in, aviso de morosidad): la deuda del mes existe
// desde el día 1 igual (se sigue mostrando en Cuotas/Deuda sin cambios), pero
// no se la trata como algo a exigir hasta pasado el día 10 — recién el 11 se
// puede considerar atrasada.
// No exportada (appcarc-backend#263): knip la marcaba "sin uso" porque nadie
// la importa de afuera, pero solo es un detalle de implementación de
// dentroDeVentanaDeGracia, que sí se usa en varios lados.
const DIA_LIMITE_PAGO_MENSUAL = 10;

// Día del mes (1-31) de `fecha`, en huso horario argentino.
export const diaDelMesArgentino = (fecha) => new Date(fecha.getTime() + ARG_OFFSET_MS).getUTCDate();

// Ninguna asistencia (escuelita, muro libre) puede quedar fechada a futuro —
// caso real (appcarc-backend#167): un check-in cargado a mano con la fecha
// mal tipeada quedó con una "visita" varios días adelante en el historial
// del socio, sin que nada lo rechazara. Usado por los handlers/servicios que
// reciben `fecha` del cliente, además del validador a nivel de modelo en
// Asistencia.js (que es la red de seguridad, no el punto de chequeo
// principal — este export es el que da el mensaje de error claro).
export const esFechaFutura = (fecha) => fecha.getTime() > Date.now();

// true si `fecha` todavía está dentro de la ventana de gracia del mes en curso.
export const dentroDeVentanaDeGracia = (fecha) => diaDelMesArgentino(fecha) <= DIA_LIMITE_PAGO_MENSUAL;

// 'YYYY-MM' de la fecha, en huso horario argentino.
export const periodoDeFecha = (fecha) => {
  const local = new Date(fecha.getTime() + ARG_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Mes en curso en hora argentina. El container corre en UTC: con el reloj del
// proceso, el último día del mes desde las 21 hs ya era el mes siguiente
// (appcarc-backend#283).
export const periodoActualArgentino = () => periodoDeFecha(new Date());

// Zona horaria para los cron de node-cron: sin ella, con el container en UTC,
// un job de "las 9" corría a las 6 de Argentina (appcarc-backend#283).
export const TIMEZONE_ARGENTINA = 'America/Argentina/Cordoba';

// Instante en que arranca el período 'YYYY-MM': el 1° del mes a las 00:00
// hora argentina (03:00 UTC). Es la fecha de referencia para buscar el precio
// que regía en ese mes (appcarc-backend#285). Cae después del hueco que deja
// resolverVigenciaPrecio al cerrar el precio anterior en desde − 24 h (D2,
// #263): un precio que arranca el 01/07 00:00 UTC ya rige a esa hora.
export const inicioDePeriodoArgentino = (periodo) => {
  const [year, month] = periodo.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, 1) - ARG_OFFSET_MS);
};

const NOMBRES_MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// 'YYYY-MM' → 'marzo 2026', para mensajes al usuario.
export const nombrePeriodo = (periodo) => {
  const [year, month] = periodo.split('-');
  return `${NOMBRES_MESES[Number(month) - 1]} ${year}`;
};

// 'YYYY-MM-DD' de la fecha, en huso horario argentino (appcarc-backend#160).
export const fechaCalendarioArgentina = (fecha) => {
  const local = new Date(fecha.getTime() + ARG_OFFSET_MS);
  return `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`;
};

// Rango UTC (00:00 a 23:59:59.999) del día calendario argentino que contiene `fecha`.
export const diaBoundsUTC = (fecha) => {
  const local = new Date(fecha.getTime() + ARG_OFFSET_MS);
  const startLocal = new Date(local); startLocal.setUTCHours(0, 0, 0, 0);
  const endLocal = new Date(local); endLocal.setUTCHours(23, 59, 59, 999);
  return {
    start: new Date(startLocal.getTime() - ARG_OFFSET_MS),
    end: new Date(endLocal.getTime() - ARG_OFFSET_MS),
  };
};

// Clave de la semana argentina (lunes a domingo) que contiene `fecha`, como
// la fecha del lunes en formato YYYY-MM-DD (ej. "2026-09-28") — mismo criterio
// de semana que semanaBoundsUTC, solo que devuelve una clave string en vez de
// un rango, para agrupar/filtrar por semana (ej. podio semanal del juego).
export const semanaKeyArgentina = (fecha) => {
  const local = new Date(fecha.getTime() + ARG_OFFSET_MS);
  const day = local.getUTCDay(); // 0=Dom, 1=Lun...
  const diffToMonday = day === 0 ? 6 : day - 1;

  const monday = new Date(local);
  monday.setUTCDate(local.getUTCDate() - diffToMonday);

  const y = monday.getUTCFullYear();
  const m = String(monday.getUTCMonth() + 1).padStart(2, '0');
  const d = String(monday.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

// Rango UTC de la semana argentina (lunes a domingo) que contiene `fecha`.
export const semanaBoundsUTC = (fecha) => {
  const local = new Date(fecha.getTime() + ARG_OFFSET_MS);
  const day = local.getUTCDay(); // 0=Dom, 1=Lun...
  const diffToMonday = day === 0 ? 6 : day - 1;

  const monday = new Date(local);
  monday.setUTCDate(local.getUTCDate() - diffToMonday);
  monday.setUTCHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  sunday.setUTCHours(23, 59, 59, 999);

  return {
    start: new Date(monday.getTime() - ARG_OFFSET_MS),
    end: new Date(sunday.getTime() - ARG_OFFSET_MS),
  };
};
