import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

import Club from '../resources/clubs/models/Club.js';
import Rol from '../resources/roles/models/Rol.js';
import { slugify } from '../resources/roles/services/slug.service.js';
import User from '../resources/usuarios/models/User.js';
import Socio from '../resources/socios/models/Socio.js';
import Etiqueta from '../resources/etiquetas/models/Etiqueta.js';
import Precios from '../resources/cuotas/models/Precios.js';
import Plan from '../resources/planes/models/Plan.js';
import Suscripcion from '../resources/suscripciones/models/Suscripcion.js';
import Cuota from '../resources/cuotas/models/Cuota.js';
import Cobro from '../resources/cobros/models/Cobro.js';
import Movimiento from '../resources/movimientos/models/Movimiento.js';
import Escuelita from '../resources/escuelita/models/Escuelita.js';
import Asistencia from '../resources/asistencias/models/Asistencia.js';
import Horarios from '../resources/horarios/models/Horarios.js';
import Novedad from '../resources/novedades/models/Novedad.js';
import Notification from '../resources/notificaciones/models/Notification.js';
import { PERMISOS, TODOS_LOS_PERMISOS } from '../constants/permisos.js';
import { ADVERTENCIA } from '../constants/advertenciaCodes.js';

// Club exclusivo para el entorno demo (autoservicio público, ver
// appcarc-backend#9). TODO lo que este archivo borra/crea está scopeado a
// este clubId — nunca debe tocar datos reales.
export const DEMO_CLUB_ID = 'demo';
const BY = 'seed:demo';

export const DEMO_CREDENTIALS = {
  socio: { email: 'socio@demo.appclub.ar', password: 'DemoSocio2026!' },
  admin: { email: 'admin@demo.appclub.ar', password: 'DemoAdmin2026!' },
  secretaria: { email: 'secretaria@demo.appclub.ar', password: 'DemoSecretaria2026!' },
  profesor: { email: 'profesor@demo.appclub.ar', password: 'DemoProfesor2026!' },
  palestrero: { email: 'palestrero@demo.appclub.ar', password: 'DemoPalestrero2026!' },
};

const P = PERMISOS;

const currentPeriodo = (offsetMonths = 0) => {
  const d = new Date();
  // Fijar el día a 1 antes de mover el mes: si no, un "hoy" con día 29-31 se
  // desborda al mes siguiente en meses más cortos (ej. día 30 - 5 meses cae
  // en un 30 de febrero inexistente, que JS corrige rebalsando a marzo) y
  // termina duplicando/salteando un período.
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + offsetMonths);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

// Crea un Cobro + Movimiento + Cuota consistentes entre sí, igual que
// registrarCobro.service.js pero simplificado a un solo ítem — para no
// depender de la forma exacta (req/user) que espera ese servicio.
async function registrarPagoDemo({ socio, suscripcion, etiquetaId, periodo, monto, session }) {
  const movimiento = await Movimiento.create([{
    clubId: DEMO_CLUB_ID,
    userId: new mongoose.Types.ObjectId(),
    responsable: 'Demo Admin',
    socioId: socio._id,
    socioNombre: `${socio.nombre} ${socio.apellido}`,
    type: 'Ingreso',
    amount: monto,
    concept: 'Cobro de cuotas',
    paymentMethod: 'Efectivo',
    description: `Cobro con 1 cuota`,
    date: new Date(),
    sourceType: 'cobro',
    sourceModel: 'Cobro',
    createdBy: BY,
    updatedBy: BY,
  }], { session });

  const cobro = await Cobro.create([{
    clubId: DEMO_CLUB_ID,
    responsable: 'Demo Admin',
    paymentMethod: 'Efectivo',
    totalAmount: monto,
    date: new Date(),
    items: [{
      socioId: socio._id,
      suscripcionId: suscripcion._id,
      etiquetaId,
      periodo,
      amount: monto,
    }],
    movimientoId: movimiento[0]._id,
    createdBy: BY,
    updatedBy: BY,
  }], { session });

  movimiento[0].sourceId = cobro[0]._id;
  await movimiento[0].save({ session });

  // upsert en vez de create: (clubId, socioId, suscripcionId, periodo, active)
  // es único — si por lo que sea ya existiera esa cuota exacta, no tiene
  // sentido que el seed reviente por eso, con actualizarla alcanza.
  await Cuota.findOneAndUpdate(
    { clubId: DEMO_CLUB_ID, socioId: socio._id, suscripcionId: suscripcion._id, periodo, active: true },
    {
      $set: {
        etiquetaId,
        estado: 'pagada',
        montoEsperadoSnapshot: monto,
        montoPagadoSnapshot: monto,
        cobroId: cobro[0]._id,
        movimientoId: movimiento[0]._id,
        fechaPago: new Date(),
        paymentMethod: 'Efectivo',
        updatedBy: BY,
      },
      $setOnInsert: { createdBy: BY },
    },
    { upsert: true, session },
  );
}

async function borrarDatosDemo() {
  await Promise.all([
    Cuota.deleteMany({ clubId: DEMO_CLUB_ID }),
    Cobro.deleteMany({ clubId: DEMO_CLUB_ID }),
    Movimiento.deleteMany({ clubId: DEMO_CLUB_ID }),
    Suscripcion.deleteMany({ clubId: DEMO_CLUB_ID }),
    Escuelita.deleteMany({ clubId: DEMO_CLUB_ID }),
    Asistencia.deleteMany({ clubId: DEMO_CLUB_ID }),
    Horarios.deleteMany({ clubId: DEMO_CLUB_ID }),
    Novedad.deleteMany({ clubId: DEMO_CLUB_ID }),
    Notification.deleteMany({ clubId: DEMO_CLUB_ID }),
    Plan.deleteMany({ clubId: DEMO_CLUB_ID }),
    Precios.deleteMany({ clubId: DEMO_CLUB_ID }),
    Etiqueta.deleteMany({ clubId: DEMO_CLUB_ID }),
    User.deleteMany({ clubId: DEMO_CLUB_ID }),
    Socio.deleteMany({ clubId: DEMO_CLUB_ID }),
    Rol.deleteMany({ clubId: DEMO_CLUB_ID }),
  ]);
}

const SOCIOS_DEMO = [
  { dni: '99000001', socioNumber: 'DEMO-001', nombre: 'Ana', apellido: 'Al Día', estado: 'Activo', deudaMeses: 0 },
  { dni: '99000002', socioNumber: 'DEMO-002', nombre: 'Bruno', apellido: 'Con Deuda Corta', estado: 'Activo', deudaMeses: 2 },
  { dni: '99000003', socioNumber: 'DEMO-003', nombre: 'Carla', apellido: 'Con Deuda Larga', estado: 'Activo', deudaMeses: 4 },
  { dni: '99000004', socioNumber: 'DEMO-004', nombre: 'Diego', apellido: 'Adherente', estado: 'Adherente', deudaMeses: 0 },
  { dni: '99000005', socioNumber: 'DEMO-005', nombre: 'Elena', apellido: 'De Baja', estado: 'Baja', deudaMeses: 0 },
  { dni: '99000006', socioNumber: 'DEMO-006', nombre: 'Facundo', apellido: 'Escuelita Principiantes', estado: 'Activo', deudaMeses: 0, escuelitaPlan: 'principiantesX1' },
  { dni: '99000007', socioNumber: 'DEMO-007', nombre: 'Gimena', apellido: 'Escuelita Avanzados', estado: 'Activo', deudaMeses: 0, escuelitaPlan: 'avanzadosX2', escuelitaDeuda: true },
  { dni: '99000008', socioNumber: 'DEMO-008', nombre: 'Hugo', apellido: 'Muro Libre', estado: 'Activo', deudaMeses: 0, muroLibre: true },
  { dni: '99000009', socioNumber: 'DEMO-009', nombre: 'Irene', apellido: 'Común', estado: 'Activo', deudaMeses: 1 },
  { dni: '99000010', socioNumber: 'DEMO-010', nombre: 'Demo', apellido: 'Socio', estado: 'Activo', deudaMeses: 1, loginRole: 'socio', muroLibre: true, muroLibreAdvertencia: true },
  { dni: '99000011', socioNumber: 'DEMO-011', nombre: 'Demo', apellido: 'Admin', estado: 'Activo', deudaMeses: 0, loginRole: 'admin' },
  { dni: '99000012', socioNumber: 'DEMO-012', nombre: 'Julia', apellido: 'Adherente Con Deuda', estado: 'Adherente', deudaMeses: 3 },
  { dni: '99000013', socioNumber: 'DEMO-013', nombre: 'Karina', apellido: 'Ex Escuelita', estado: 'Activo', deudaMeses: 0, escuelitaPlan: 'principiantesX2', escuelitaEstado: 'baja' },
  { dni: '99000014', socioNumber: 'DEMO-014', nombre: 'Pedro', apellido: 'Profesor', estado: 'Activo', deudaMeses: 0, esStaffProfesor: true, loginRole: 'profesor' },
  { dni: '99000015', socioNumber: 'DEMO-015', nombre: 'Rocío', apellido: 'Palestrero', estado: 'Activo', deudaMeses: 0, loginRole: 'palestrero' },
  { dni: '99000016', socioNumber: 'DEMO-016', nombre: 'Sofía', apellido: 'Secretaria', estado: 'Activo', deudaMeses: 0, loginRole: 'secretaria' },
];

const ROLES_DEMO = [
  { nombre: 'admin', permisos: TODOS_LOS_PERMISOS },
  {
    nombre: 'secretaria',
    permisos: [
      P.SOCIOS_READ, P.SOCIOS_WRITE, P.SOCIOS_RESTORE,
      P.COBROS_READ, P.COBROS_WRITE, P.COBROS_DELETE, P.COBROS_PRECIO_HISTORICO,
      P.MOVIMIENTOS_READ, P.MOVIMIENTOS_WRITE, P.MOVIMIENTOS_DELETE,
      P.ESCUELITA_READ, P.ESCUELITA_WRITE, P.ESCUELITA_DELETE, P.ESCUELITA_CHECKIN,
      P.MURO_LIBRE_READ, P.MURO_LIBRE_WRITE, P.MURO_LIBRE_DELETE, P.MURO_LIBRE_CHECKIN,
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE, P.HORARIOS_DEUDA,
      P.ETIQUETAS_READ, P.ETIQUETAS_WRITE, P.ETIQUETAS_DELETE,
      P.PRECIOS_READ,
      P.PLANES_READ, P.PLANES_WRITE, P.PLANES_DELETE,
      P.SUSCRIPCIONES_READ, P.SUSCRIPCIONES_WRITE, P.SUSCRIPCIONES_CLOSE, P.SUSCRIPCIONES_DELETE,
      P.ASISTENCIAS_READ, P.ASISTENCIAS_WRITE,
      P.ADVERTENCIAS_READ,
      P.NOVEDADES_WRITE,
      P.AUDIT_READ,
    ],
  },
  {
    nombre: 'profesor',
    permisos: [
      P.SOCIOS_READ,
      P.ESCUELITA_READ, P.ESCUELITA_WRITE, P.ESCUELITA_DELETE, P.ESCUELITA_CHECKIN,
      P.PLANES_READ,
      P.ETIQUETAS_READ, P.PRECIOS_READ,
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE,
      P.ASISTENCIAS_READ, P.ASISTENCIAS_WRITE,
    ],
  },
  {
    nombre: 'palestrero',
    permisos: [
      P.SOCIOS_READ,
      P.MURO_LIBRE_READ, P.MURO_LIBRE_WRITE, P.MURO_LIBRE_DELETE, P.MURO_LIBRE_CHECKIN,
      P.HORARIOS_READ, P.HORARIOS_WRITE, P.HORARIOS_DELETE,
      P.ETIQUETAS_READ, P.PRECIOS_READ,
    ],
  },
  { nombre: 'socio', permisos: [P.MURO_LIBRE_READ, P.ASISTENCIAS_READ] },
];

export async function resetDemoClub() {
  await Club.findOneAndUpdate(
    { slug: DEMO_CLUB_ID },
    {
      $set: {
        nombre: 'Club Demo (appClub)',
        slug: DEMO_CLUB_ID,
        plan: 'premium',
        modulos: { escuelita: true, muroLibre: true, exportSheets: false, novedades: false },
        active: true,
      },
    },
    { upsert: true },
  );

  await borrarDatosDemo();

  const rolesCreados = await Rol.insertMany(ROLES_DEMO.map((r) => ({ clubId: DEMO_CLUB_ID, nombre: r.nombre, slug: slugify(r.nombre), permisos: r.permisos, active: true })));
  const rolIdPorNombre = Object.fromEntries(rolesCreados.map((r) => [r.nombre, r._id]));

  const [
    etiquetaSocial,
    etiquetaEscuelitaX1,
    etiquetaEscuelitaX2,
    etiquetaMuroDiarioSocio,
    etiquetaMuroDiarioNoSocio,
    etiquetaHoraProfesor,
    etiquetaHoraPalestrero,
  ] = await Etiqueta.insertMany([
    { clubId: DEMO_CLUB_ID, nombre: 'Cuota Social', unidad: 'mes', uso_sistema: 'cuota_social', active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, nombre: 'Cuota Escuelita x1', unidad: 'mes', uso_sistema: null, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, nombre: 'Cuota Escuelita x2', unidad: 'mes', uso_sistema: null, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, nombre: 'Muro Libre Diario - Socio', unidad: 'dia', uso_sistema: 'muro_libre_diario_socio', active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, nombre: 'Muro Libre Diario - No Socio', unidad: 'dia', uso_sistema: 'muro_libre_diario_no_socio', active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, nombre: 'Hora Profesor', unidad: 'hora', uso_sistema: null, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, nombre: 'Hora Palestrero', unidad: 'hora', uso_sistema: null, active: true, createdBy: BY, updatedBy: BY },
  ]);

  const vigenteDesde = new Date();
  vigenteDesde.setUTCDate(1); // ver comentario en currentPeriodo() — evita el mismo desborde de mes
  vigenteDesde.setUTCMonth(vigenteDesde.getUTCMonth() - 6);
  await Precios.insertMany([
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaSocial._id, nombre: 'Cuota Social', unidad: 'mes', monto: 15000, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaEscuelitaX1._id, nombre: 'Cuota Escuelita x1', unidad: 'mes', monto: 20000, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaEscuelitaX2._id, nombre: 'Cuota Escuelita x2', unidad: 'mes', monto: 30000, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaMuroDiarioSocio._id, nombre: 'Muro Libre Diario - Socio', unidad: 'dia', monto: 5000, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaMuroDiarioNoSocio._id, nombre: 'Muro Libre Diario - No Socio', unidad: 'dia', monto: 8000, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaHoraProfesor._id, nombre: 'Hora Profesor', unidad: 'hora', monto: 4000, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
    { clubId: DEMO_CLUB_ID, etiquetaId: etiquetaHoraPalestrero._id, nombre: 'Hora Palestrero', unidad: 'hora', monto: 3500, vigenteDesde, active: true, createdBy: BY, updatedBy: BY },
  ]);

  const [
    planSocial,
    planPrincipiantesX1,
    planPrincipiantesX2,
    planAvanzadosX2,
    planMuroSocio,
    planMuroNoSocio,
  ] = await Plan.insertMany([
    {
      clubId: DEMO_CLUB_ID, nombre: 'Socio Activo',
      descripcion: 'Cuota mensual estándar para socios activos del club.',
      tipo: 'social', modalidad: 'mensual', etiquetaId: etiquetaSocial._id, atributos: {},
      active: true, createdBy: BY, updatedBy: BY,
    },
    {
      clubId: DEMO_CLUB_ID, nombre: 'Escuelita Principiantes X1',
      descripcion: 'Para alumnos que recién empiezan a escalar: una clase por semana.',
      tipo: 'escuelita', modalidad: 'mensual', etiquetaId: etiquetaEscuelitaX1._id,
      atributos: { frecuenciaSemanal: 1, codigo: 'principiantes_x1' },
      active: true, createdBy: BY, updatedBy: BY,
    },
    {
      clubId: DEMO_CLUB_ID, nombre: 'Escuelita Principiantes X2',
      descripcion: 'Alumnos principiantes que ya entrenan dos veces por semana.',
      tipo: 'escuelita', modalidad: 'mensual', etiquetaId: etiquetaEscuelitaX2._id,
      atributos: { frecuenciaSemanal: 2, codigo: 'principiantes_x2' },
      active: true, createdBy: BY, updatedBy: BY,
    },
    {
      clubId: DEMO_CLUB_ID, nombre: 'Escuelita Avanzados X2',
      descripcion: 'Grupo avanzado de escalada, dos clases semanales con mayor nivel técnico.',
      tipo: 'escuelita', modalidad: 'mensual', etiquetaId: etiquetaEscuelitaX2._id,
      atributos: { frecuenciaSemanal: 2, codigo: 'avanzados_x2' },
      active: true, createdBy: BY, updatedBy: BY,
    },
    {
      clubId: DEMO_CLUB_ID, nombre: 'Muro Libre Diario - Socio',
      descripcion: 'Pase diario para socios que quieren usar el muro de escalada libre, sin necesidad de una cuota mensual.',
      tipo: 'muro_libre', modalidad: 'por_uso', etiquetaId: etiquetaMuroDiarioSocio._id,
      atributos: { requiereSocio: true },
      active: true, createdBy: BY, updatedBy: BY,
    },
    {
      clubId: DEMO_CLUB_ID, nombre: 'Muro Libre Diario - No Socio',
      descripcion: 'Pase diario para quienes no son socios del club y quieren probar el muro de escalada.',
      tipo: 'muro_libre', modalidad: 'por_uso', etiquetaId: etiquetaMuroDiarioNoSocio._id,
      atributos: { requiereSocio: false },
      active: true, createdBy: BY, updatedBy: BY,
    },
  ]);
  // Referenciados para que no queden como "declarados pero sin usar" — son
  // parte del catálogo de planes de muestra, aunque el seed no los use para
  // suscribir a ningún socio ficticio (el pase de muro libre no requiere
  // suscripción, se paga por uso).
  void planMuroSocio;
  void planMuroNoSocio;

  const ESCUELITA_PLANES = {
    principiantesX1: { plan: planPrincipiantesX1, etiquetaId: etiquetaEscuelitaX1._id, monto: 20000, frecuencia: 1 },
    principiantesX2: { plan: planPrincipiantesX2, etiquetaId: etiquetaEscuelitaX2._id, monto: 30000, frecuencia: 2 },
    avanzadosX2: { plan: planAvanzadosX2, etiquetaId: etiquetaEscuelitaX2._id, monto: 30000, frecuencia: 2 },
  };

  const fechaDesde = currentPeriodo(-6);
  // El período actual también cuenta como "adeudable" — desde fechaDesde
  // (hace 6 meses) hasta hoy inclusive son 7 períodos en total.
  const TOTAL_PERIODOS = 7;
  const socioIdByLogin = {};

  for (const def of SOCIOS_DEMO) {
    const socio = await Socio.create({
      socioNumber: def.socioNumber,
      apellido: def.apellido,
      nombre: def.nombre,
      dni: def.dni,
      estado: def.estado,
      correoElectronico: def.loginRole ? DEMO_CREDENTIALS[def.loginRole].email : null,
      clubId: DEMO_CLUB_ID,
      active: true,
      createdBy: BY,
      updatedBy: BY,
    });

    if (def.loginRole) socioIdByLogin[def.loginRole] = socio._id;

    if (def.estado === 'Baja') continue; // sin suscripción ni cuotas — coherente con estar de baja

    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const suscripcionSocial = (await Suscripcion.create([{
          clubId: DEMO_CLUB_ID,
          socioId: socio._id,
          planId: planSocial._id,
          etiquetaId: etiquetaSocial._id,
          fechaDesde,
          active: true,
          createdBy: BY,
          updatedBy: BY,
        }], { session }))[0];

        const mesesAPagar = TOTAL_PERIODOS - def.deudaMeses;
        for (let i = 0; i < mesesAPagar; i++) {
          await registrarPagoDemo({
            socio,
            suscripcion: suscripcionSocial,
            etiquetaId: etiquetaSocial._id,
            periodo: currentPeriodo(-6 + i),
            monto: 15000,
            session,
          });
        }

        if (def.escuelitaPlan) {
          const cfg = ESCUELITA_PLANES[def.escuelitaPlan];
          // "Escuelita Baja" ya no es un estado visible — se modela igual que
          // una baja real (borrar): la ficha y la suscripción quedan inactivas.
          const alumnoBorrado = def.escuelitaEstado === 'baja';

          const suscripcionEscuelita = (await Suscripcion.create([{
            clubId: DEMO_CLUB_ID,
            socioId: socio._id,
            planId: cfg.plan._id,
            etiquetaId: cfg.etiquetaId,
            fechaDesde,
            active: !alumnoBorrado,
            createdBy: BY,
            updatedBy: BY,
          }], { session }))[0];

          await Escuelita.create([{
            clubId: DEMO_CLUB_ID,
            socioId: socio._id,
            dni: socio.dni,
            fechaInscripcion: vigenteDesde,
            planId: cfg.plan._id,
            observaciones: alumnoBorrado
              ? 'Inscripción borrada — no se anota asistencia.'
              : `Alumno de "${cfg.plan.nombre}", ${cfg.frecuencia}x por semana.`,
            active: !alumnoBorrado,
            createdBy: BY,
            updatedBy: BY,
          }], { session });

          const mesesEscuelitaAPagar = def.escuelitaDeuda ? TOTAL_PERIODOS - 3 : TOTAL_PERIODOS;
          for (let i = 0; i < mesesEscuelitaAPagar; i++) {
            await registrarPagoDemo({
              socio,
              suscripcion: suscripcionEscuelita,
              etiquetaId: cfg.etiquetaId,
              periodo: currentPeriodo(-6 + i),
              monto: cfg.monto,
              session,
            });
          }

          // Clases a las que asistió, respetando su frecuencia semanal — un
          // alumno con la inscripción borrada no tiene asistencia reciente.
          if (!alumnoBorrado) {
            const SEMANAS_HISTORIAL = 4;
            for (let semana = 0; semana < SEMANAS_HISTORIAL; semana++) {
              for (let clase = 0; clase < cfg.frecuencia; clase++) {
                const diasAtras = semana * 7 + clase * 3;
                await Asistencia.create([{
                  clubId: DEMO_CLUB_ID,
                  tipo: 'escuelita',
                  socioId: socio._id,
                  nombre: socio.nombre,
                  apellido: socio.apellido,
                  dni: socio.dni,
                  esSocio: true,
                  fecha: new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000),
                  categoria: cfg.plan.nombre,
                  checkinMethod: 'MANUAL',
                  observaciones: '',
                  createdBy: BY,
                  updatedBy: BY,
                }], { session });
              }
            }
          }
        }

        if (def.muroLibre) {
          // Varias visitas repartidas en las últimas semanas, no solo hoy.
          const diasAtras = [0, 6, 13, 20];
          for (let v = 0; v < diasAtras.length; v++) {
            const fechaVisita = new Date(Date.now() - diasAtras[v] * 24 * 60 * 60 * 1000);
            const esUltima = v === 0;
            await Asistencia.create([{
              clubId: DEMO_CLUB_ID,
              tipo: 'muro_libre',
              socioId: socio._id,
              nombre: socio.nombre,
              apellido: socio.apellido,
              dni: socio.dni,
              esSocio: true,
              fecha: fechaVisita,
              tipoPase: 'diario',
              estadoPago: 'pagado',
              monto: 5000,
              formaPago: 'Efectivo',
              advertencias: (esUltima && def.muroLibreAdvertencia)
                ? [{ codigo: ADVERTENCIA.CUOTA_SOCIAL_IMPAGA, mensaje: `Sin cuota social pagada para ${currentPeriodo(0)}` }]
                : [],
              createdBy: BY,
              updatedBy: BY,
            }], { session });
          }
        }

        if (def.esStaffProfesor) {
          // Horas dictando clases de escuelita, para mostrar el cálculo de
          // "deuda del club con el staff" (Horarios + Precios por hora).
          const turnos = [
            { diasAtras: 2, horas: 3 },
            { diasAtras: 9, horas: 3 },
            { diasAtras: 16, horas: 2 },
          ];
          for (const { diasAtras, horas } of turnos) {
            await Horarios.create([{
              idHorarios: new mongoose.Types.ObjectId().toString(),
              clubId: DEMO_CLUB_ID,
              socioId: socio._id,
              fecha: new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000),
              etiquetaId: etiquetaHoraProfesor._id,
              totalHoras: horas,
              observaciones: 'Horas dictando clases de escuelita.',
              createdBy: BY,
              updatedBy: BY,
            }], { session });
          }
        }
      });
    } finally {
      session.endSession();
    }
  }

  const USUARIOS_DEMO = [
    { loginRole: 'socio', nombre: 'Demo Socio', roles: ['socio'] },
    { loginRole: 'admin', nombre: 'Demo Admin', roles: ['admin', 'socio'] },
    { loginRole: 'secretaria', nombre: 'Sofía Secretaria', roles: ['secretaria', 'socio'] },
    { loginRole: 'profesor', nombre: 'Pedro Profesor', roles: ['profesor', 'socio'] },
    { loginRole: 'palestrero', nombre: 'Rocío Palestrero', roles: ['palestrero', 'socio'] },
  ];

  const usersCreados = await User.insertMany(
    await Promise.all(USUARIOS_DEMO.map(async (u) => ({
      email: DEMO_CREDENTIALS[u.loginRole].email,
      password: await bcrypt.hash(DEMO_CREDENTIALS[u.loginRole].password, 10),
      nombre: u.nombre,
      roles: u.roles.map((nombre) => rolIdPorNombre[nombre]),
      clubId: DEMO_CLUB_ID,
      socioId: String(socioIdByLogin[u.loginRole]),
      active: true,
    }))),
  );
  const userSocio = usersCreados.find((u) => u.email === DEMO_CREDENTIALS.socio.email);

  const dias = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
  await Notification.insertMany([
    // Sin ver
    { clubId: DEMO_CLUB_ID, userId: userSocio._id, title: 'Pago registrado', body: 'Se registró el pago de tu cuota social para el mes pasado', data: { tipo: 'cobro_registrado' }, read: false, createdAt: dias(0) },
    { clubId: DEMO_CLUB_ID, userId: userSocio._id, title: 'Novedad del club', body: 'Salida de trekking este fin de semana — anotate en la bio de Instagram', data: { tipo: 'novedad' }, read: false, createdAt: dias(1) },
    // Historial (ya leídas)
    { clubId: DEMO_CLUB_ID, userId: userSocio._id, title: 'Recordatorio de cuotas - este mes', body: 'Tenés cuotas pendientes: cuota social (1 mes). ¡No te olvides de ponerte al día!', data: { tipo: 'recordatorio_cuotas' }, read: true, createdAt: dias(5) },
    { clubId: DEMO_CLUB_ID, userId: userSocio._id, title: 'Actualización de tu ficha de socio', body: 'Se actualizó tu teléfono de contacto', data: { tipo: 'socio_update' }, read: true, createdAt: dias(12) },
  ]);

  await Novedad.insertMany([
    {
      clubId: DEMO_CLUB_ID,
      fuente: 'manual',
      titulo: 'Bienvenidos al club demo de appClub',
      cuerpo: 'Este es un entorno de prueba con datos ficticios, pensado para mostrar el sistema. Se resetea todos los días.',
      fechaPublicacion: new Date(),
      createdBy: BY,
      active: true,
    },
    {
      clubId: DEMO_CLUB_ID,
      fuente: 'manual',
      titulo: 'Salida de trekking este fin de semana',
      cuerpo: 'Ejemplo de novedad cargada manualmente por secretaría.',
      fechaPublicacion: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      createdBy: BY,
      active: true,
    },
  ]);

  return {
    clubId: DEMO_CLUB_ID,
    socios: SOCIOS_DEMO.length,
    credenciales: DEMO_CREDENTIALS,
  };
}

export default resetDemoClub;
