import { describe, it, expect } from 'vitest';
import { resetDemoClub, DEMO_CLUB_ID, DEMO_CREDENTIALS } from '../../demoSeed.service.js';
import { calcularDeuda } from '../../../resources/cuotas/services/calcularDeuda.service.js';
import { getDeudaStaffHandler } from '../../../resources/horarios/handlers/getDeudaStaff.handler.js';
import Club from '../../../resources/clubs/models/Club.js';
import Socio from '../../../resources/socios/models/Socio.js';
import User from '../../../resources/usuarios/models/User.js';
import Escuelita from '../../../resources/escuelita/models/Escuelita.js';
import Asistencia from '../../../resources/asistencias/models/Asistencia.js';
import Plan from '../../../resources/planes/models/Plan.js';
import Rol from '../../../resources/roles/models/Rol.js';
import { PERMISOS } from '../../../constants/permisos.js';

const mockRes = () => {
  const res = {};
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};

describe('resetDemoClub (integración)', () => {
  it('crea el club demo con datos consistentes y deuda calculable', async () => {
    await resetDemoClub();

    const club = await Club.findOne({ slug: DEMO_CLUB_ID }).lean();
    expect(club).toBeTruthy();
    expect(club.active).toBe(true);

    const socios = await Socio.find({ clubId: DEMO_CLUB_ID }).lean();
    expect(socios.length).toBe(16);

    const users = await User.find({ clubId: DEMO_CLUB_ID }).lean();
    expect(users.map((u) => u.email).sort()).toEqual(
      Object.values(DEMO_CREDENTIALS).map((c) => c.email).sort(),
    );

    const alDia = socios.find((s) => s.apellido === 'Al Día');
    const deudaAlDia = await calcularDeuda({ socioId: alDia._id, clubId: DEMO_CLUB_ID });
    expect(deudaAlDia.suscripciones.reduce((acc, d) => acc + d.mesesDeuda, 0)).toBe(0);

    const deudaLarga = socios.find((s) => s.apellido === 'Con Deuda Larga');
    const deudaDeudaLarga = await calcularDeuda({ socioId: deudaLarga._id, clubId: DEMO_CLUB_ID });
    expect(deudaDeudaLarga.suscripciones.reduce((acc, d) => acc + d.mesesDeuda, 0)).toBe(4);

    const baja = socios.find((s) => s.apellido === 'De Baja');
    expect(baja.estado).toBe('Baja');
    const deudaBaja = await calcularDeuda({ socioId: baja._id, clubId: DEMO_CLUB_ID });
    expect(deudaBaja).toEqual({ suscripciones: [], otrosCargos: [] });
  });

  it('arma alumnos de escuelita con clases asistidas, un alumno con la inscripción borrada y horas de staff', async () => {
    await resetDemoClub();

    const facundo = await Socio.findOne({ clubId: DEMO_CLUB_ID, apellido: 'Escuelita Principiantes' }).lean();
    const clasesFacundo = await Asistencia.find({ clubId: DEMO_CLUB_ID, socioId: facundo._id, tipo: 'escuelita' }).lean();
    // Principiantes X1 → 1 clase/semana × 4 semanas de historial
    expect(clasesFacundo.length).toBe(4);

    const gimena = await Socio.findOne({ clubId: DEMO_CLUB_ID, apellido: 'Escuelita Avanzados' }).lean();
    const clasesGimena = await Asistencia.find({ clubId: DEMO_CLUB_ID, socioId: gimena._id, tipo: 'escuelita' }).lean();
    // Avanzados X2 → 2 clases/semana × 4 semanas de historial
    expect(clasesGimena.length).toBe(8);

    const karina = await Socio.findOne({ clubId: DEMO_CLUB_ID, apellido: 'Ex Escuelita' }).lean();
    const alumnoKarina = await Escuelita.findOne({ clubId: DEMO_CLUB_ID, socioId: karina._id }).lean();
    expect(alumnoKarina.active).toBe(false);
    const clasesKarina = await Asistencia.find({ clubId: DEMO_CLUB_ID, socioId: karina._id, tipo: 'escuelita' }).lean();
    expect(clasesKarina.length).toBe(0);

    const planes = await Plan.find({ clubId: DEMO_CLUB_ID, tipo: 'escuelita' }).lean();
    expect(planes.every((p) => p.descripcion?.length > 0)).toBe(true);

    const req = { user: { clubId: DEMO_CLUB_ID }, query: { periodo: new Date().toISOString().slice(0, 7) } };
    const res = mockRes();
    await getDeudaStaffHandler(req, res);
    expect(res.statusCode).toBe(200);
    const pedro = res.body.find((d) => d.nombre === 'Pedro Profesor');
    expect(pedro).toBeTruthy();
    expect(pedro.totalDeuda).toBeGreaterThan(0);
  });

  it('crea logins de secretaria/profesor/palestrero con permisos acotados y propios', async () => {
    await resetDemoClub();

    const users = await User.find({ clubId: DEMO_CLUB_ID }).lean();
    for (const rol of ['secretaria', 'profesor', 'palestrero']) {
      const rolDoc = await Rol.findOne({ clubId: DEMO_CLUB_ID, nombre: rol }).lean();
      expect(rolDoc).toBeTruthy();
      expect(rolDoc.slug).toBe(rol); // nombres del seed demo ya son slugs válidos tal cual
      // No deberían tener permisos de administración total.
      expect(rolDoc.permisos).not.toContain(PERMISOS.USUARIOS_WRITE);

      const rolSocioDoc = await Rol.findOne({ clubId: DEMO_CLUB_ID, nombre: 'socio' }).lean();
      const tieneRol = (u, id) => u.roles.some((r) => String(r) === String(id));
      const user = users.find((u) => tieneRol(u, rolDoc._id));
      expect(user, `debería existir un login con rol ${rol}`).toBeTruthy();
      expect(tieneRol(user, rolSocioDoc._id)).toBe(true); // también son socios, como en CARC real
    }

    const profesorRol = await Rol.findOne({ clubId: DEMO_CLUB_ID, nombre: 'profesor' }).lean();
    expect(profesorRol.permisos).toContain(PERMISOS.ESCUELITA_WRITE);
    expect(profesorRol.permisos).not.toContain(PERMISOS.MURO_LIBRE_WRITE);

    const palestreroRol = await Rol.findOne({ clubId: DEMO_CLUB_ID, nombre: 'palestrero' }).lean();
    expect(palestreroRol.permisos).toContain(PERMISOS.MURO_LIBRE_WRITE);
    expect(palestreroRol.permisos).not.toContain(PERMISOS.ESCUELITA_WRITE);
  });

  it('es idempotente: correrlo dos veces no duplica datos ni rompe', async () => {
    await resetDemoClub();
    await resetDemoClub();

    const socios = await Socio.find({ clubId: DEMO_CLUB_ID }).lean();
    expect(socios.length).toBe(16);

    const users = await User.find({ clubId: DEMO_CLUB_ID }).lean();
    expect(users.length).toBe(5);
  });

  it('no toca datos de otros clubes', async () => {
    await Socio.create({
      nombre: 'Real', apellido: 'CARC', dni: '11111111', clubId: 'CARC', active: true,
    });

    await resetDemoClub();

    const socioReal = await Socio.findOne({ clubId: 'CARC', dni: '11111111' });
    expect(socioReal).toBeTruthy();
  });
});
