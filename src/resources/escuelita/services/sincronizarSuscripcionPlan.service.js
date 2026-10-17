import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import Plan from '../../planes/models/Plan.js';
import Escuelita from '../models/Escuelita.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { getActor } from '../../../services/getActor.js';
import { periodoActualArgentino } from '../../../services/fechaArgentina.js';
import { periodoAnterior as periodoAnteriorDe } from '../../../services/periodos.js';

class BusinessError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = 'BusinessError';
    this.status = status;
  }
}

// Mes en curso y anterior en hora argentina, no en UTC (appcarc-backend#283).
const currentPeriodo = () => periodoActualArgentino();

const previousPeriodo = () => periodoAnteriorDe(periodoActualArgentino());

// Está "activa este período" si no tiene fechaHasta o si fechaHasta todavía no pasó.
const vigenteEsteMes = (suscripcion, periodo) => (
  !suscripcion.fechaHasta || suscripcion.fechaHasta >= periodo
);

// Etiquetas que corresponde algún Plan de escuelita vigente — necesario porque
// casi ninguna Suscripcion vieja/migrada tiene un Plan asociado (ver comentario
// más abajo en sincronizarSuscripcionEscuelita).
const getEtiquetaIdsEscuelita = async ({ clubId, session }) => {
  const planesEscuelita = await Plan.find({ clubId, tipo: 'escuelita', active: true })
    .select('etiquetaId')
    .session(session)
    .lean();
  return new Set(planesEscuelita.map((p) => String(p.etiquetaId)));
};

// Asignar/quitar el plan de escuelita de un alumno (Escuelita.planId) tiene que
// mantener en sincro la Suscripcion que efectivamente genera el cobro — antes
// eran dos pasos manuales y desconectados (ver appcarc-backend#12: cuatro
// alumnos terminaron con deuda duplicada o facturada bajo el plan equivocado
// por esto mismo).
export async function sincronizarSuscripcionEscuelita({ clubId, socioId, planId, req, session }) {
  const periodoActual = currentPeriodo();
  const periodoAnterior = previousPeriodo();
  const actor = getActor(req);

  let plan = null;
  if (planId) {
    plan = await Plan.findOne({ _id: planId, clubId, active: true, tipo: 'escuelita' }).session(session);
    if (!plan) {
      throw new BusinessError('El plan indicado no existe, está inactivo o no es de tipo escuelita', 400);
    }
  }

  const activas = await Suscripcion.find({ clubId, socioId, active: true })
    .populate('planId', 'tipo')
    .session(session);

  // No alcanza con mirar planId?.tipo: casi ninguna suscripción vieja/migrada
  // tiene un Plan asociado (se crearon por script o por asignación suelta de
  // etiquetaId), así que ese chequeo solo nunca las encontraba y quedaban
  // duplicadas al reasignar plan — mismo bug que appcarc-backend#31, acá en
  // Escuelita. Se complementa comparando contra el conjunto de etiquetas que
  // usa cualquier Plan de escuelita vigente, para detectar la suscripción
  // vieja tenga o no un Plan asociado.
  const etiquetaIdsEscuelita = await getEtiquetaIdsEscuelita({ clubId, session });

  const escuelitaActivas = activas.filter(
    (s) => (s.planId?.tipo === 'escuelita' || etiquetaIdsEscuelita.has(String(s.etiquetaId)))
      && vigenteEsteMes(s, periodoActual),
  );

  const yaCorrecta = plan
    && escuelitaActivas.find((s) => String(s.etiquetaId) === String(plan.etiquetaId));

  for (const s of escuelitaActivas) {
    if (yaCorrecta && String(s._id) === String(yaCorrecta._id)) continue;

    const before = s.toObject();
    if (s.fechaDesde >= periodoActual) {
      // Se creó este mismo período y nunca llegó a estar vigente de verdad
      // (ej. se eligió el plan equivocado y se corrigió al toque) — desactivarla
      // en vez de cerrarla con una fecha anterior a su propio inicio.
      s.active = false;
    } else {
      s.fechaHasta = periodoAnterior;
    }
    s.updatedBy = actor;
    await s.save({ session });
    logAudit({ clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: s._id, before, after: s.toObject() });
  }

  if (!plan) return;

  if (yaCorrecta) {
    if (String(yaCorrecta.planId?._id ?? yaCorrecta.planId) !== String(plan._id)) {
      const before = yaCorrecta.toObject();
      yaCorrecta.planId = plan._id;
      yaCorrecta.updatedBy = actor;
      await yaCorrecta.save({ session });
      logAudit({ clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: yaCorrecta._id, before, after: yaCorrecta.toObject() });
    }
    return;
  }

  // Puede existir una Suscripcion inactiva (soft-delete) para el mismo
  // período/etiqueta — el índice único no libera el slot con active:false,
  // así que la reactivamos en vez de intentar crear una nueva y chocar.
  const existente = await Suscripcion.findOne({
    clubId, socioId, etiquetaId: plan.etiquetaId, fechaDesde: periodoActual,
  }).session(session);

  if (existente) {
    const before = existente.toObject();
    existente.active = true;
    existente.planId = plan._id;
    existente.fechaHasta = null;
    existente.updatedBy = actor;
    await existente.save({ session });
    logAudit({ clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: existente._id, before, after: existente.toObject() });
    return;
  }

  const nueva = new Suscripcion({
    clubId,
    socioId,
    planId: plan._id,
    etiquetaId: plan.etiquetaId,
    fechaDesde: periodoActual,
    createdBy: actor,
    updatedBy: actor,
  });
  await nueva.save({ session });
  logAudit({ clubId, req, action: 'CREATE', resource: 'Suscripcion', resourceId: nueva._id, before: null, after: nueva.toObject() });
}

// Sentido inverso de sincronizarSuscripcionEscuelita: cuando se borra, cierra
// o recorta la Suscripcion que respalda a un alumno de escuelita, la ficha
// Escuelita tiene que reflejarlo — si no, el alumno sigue figurando activo
// (cupos, reportes, habilitado para hacer check-in) sin ninguna suscripción
// vigente detrás (appcarc-backend#62). Se llama con la etiquetaId de la
// Suscripcion recién modificada; si esa etiqueta no es de escuelita, no hace
// nada. Si lo es, revisa si el socio todavía tiene ALGUNA suscripción vigente
// este mes para cualquier etiqueta de escuelita (puede tener más de una) antes
// de dar de baja la ficha.
export async function sincronizarEscuelitaPorSuscripcionModificada({ clubId, socioId, etiquetaId, req, session }) {
  const etiquetaIdsEscuelita = await getEtiquetaIdsEscuelita({ clubId, session });
  if (!etiquetaIdsEscuelita.has(String(etiquetaId))) return;

  const periodoActual = currentPeriodo();
  const sigueVigente = await Suscripcion.exists({
    clubId,
    socioId,
    active: true,
    etiquetaId: { $in: [...etiquetaIdsEscuelita] },
    fechaDesde: { $lte: periodoActual },
    $or: [{ fechaHasta: null }, { fechaHasta: { $gte: periodoActual } }],
  }).session(session);
  if (sigueVigente) return;

  const alumno = await Escuelita.findOne({ clubId, socioId, active: true }).session(session);
  if (!alumno) return;

  const before = alumno.toObject();
  alumno.active = false;
  alumno.updatedBy = getActor(req);
  await alumno.save({ session });
  logAudit({ clubId, req, action: 'UPDATE', resource: 'Escuelita', resourceId: alumno._id, before, after: alumno.toObject() });
}

export { BusinessError };
export default sincronizarSuscripcionEscuelita;
