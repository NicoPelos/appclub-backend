import Movimiento from '../models/Movimiento.js';

// Punto único para armar el Movimiento de un pago — antes cada dominio
// (Cobro, Muro Libre, Eventos) lo armaba a mano con la misma forma, y esa
// duplicación fue justo lo que dejó pasar el bug de registrarCobro.service.js
// (concept fijo 'Cobro de cuotas' sin importar qué se cobró de verdad, ver
// resolverConceptoCobro en ese mismo archivo). Cada caller sigue decidiendo
// `concept`/`categoria`/`eventoId` según su propio dominio — esto solo
// centraliza CÓMO se arma y guarda el Movimiento en sí, no qué dice.
export const crearMovimientoDePago = async ({
  clubId, userId, actor, socioId = null, socioNombre = '', amount, concept,
  categoria = null, paymentMethod, description = '', date, sourceType,
  sourceId, sourceModel, eventoId = null, session,
}) => {
  const movimiento = new Movimiento({
    clubId,
    userId,
    responsable: actor,
    socioId,
    socioNombre,
    type: 'Ingreso',
    amount,
    concept,
    categoria,
    paymentMethod,
    description,
    date,
    sourceType,
    sourceId,
    sourceModel,
    eventoId,
    createdBy: actor,
    updatedBy: actor,
  });
  await movimiento.save({ session });
  return movimiento;
};

export default crearMovimientoDePago;
