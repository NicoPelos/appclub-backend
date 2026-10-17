import Suscripcion from '../../suscripciones/models/Suscripcion.js';
import { logAudit } from '../../audit/services/audit.service.js';
import { periodoDeFecha } from '../../../services/fechaArgentina.js';
import { getActor } from '../../../services/getActor.js';

// appcarc-backend#160: reusa fechaArgentina.js en vez de reimplementar el
// offset ART a mano.
const periodoActual = () => periodoDeFecha(new Date());

// Corta la generación de deuda futura de un socio que se da de baja: cierra
// (fechaHasta = período actual) todas sus Suscripciones abiertas. Compartido
// entre updateSocioHandler (estado: 'Baja') y deleteSocioHandler (papelera) —
// antes solo lo hacía el primero, así que un socio borrado por la papelera
// seguía generando deuda fantasma indefinidamente (appcarc-backend#131).
export const cerrarSuscripcionesPorBaja = async ({ clubId, socioId, req }) => {
  const activas = await Suscripcion.find({ clubId, socioId, active: true, fechaHasta: null });
  const periodo = periodoActual();
  for (const s of activas) {
    const antes = s.toObject();
    s.fechaHasta = periodo;
    s.updatedBy = getActor(req);
    await s.save();
    logAudit({ clubId, req, action: 'UPDATE', resource: 'Suscripcion', resourceId: s._id, before: antes, after: s.toObject() });
  }
};

export default cerrarSuscripcionesPorBaja;
