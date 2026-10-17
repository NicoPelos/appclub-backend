import mongoose from 'mongoose';

const asistenciaSchema = new mongoose.Schema({
  clubId: { type: String, required: true, index: true },
  tipo: { type: String, enum: ['muro_libre', 'escuelita'], required: true, index: true },
  socioId: { type: mongoose.Schema.Types.ObjectId, ref: 'Socio', default: null, index: true },
  nombre: { type: String, required: true },
  apellido: { type: String, default: '' },
  dni: { type: String, default: '' },
  esSocio: { type: Boolean, required: true, index: true },
  // Backstop a nivel de modelo: ninguna asistencia puede quedar fechada a
  // futuro — encontramos un caso real (appcarc-backend#167) donde un dato
  // mal cargado a mano dejó una "visita" con fecha varios días adelante,
  // sin que ningún handler lo rechazara. Los handlers que reciben `fecha`
  // del cliente además validan explícito antes de llegar acá (para dar un
  // mensaje de error claro) — esto es la red de seguridad si alguno se
  // olvida. Solo corre en save() de un documento; los `findOneAndUpdate`
  // que toquen fecha necesitan `runValidators: true` para que aplique.
  fecha: {
    type: Date,
    required: true,
    default: Date.now,
    index: true,
    validate: {
      validator: (v) => v.getTime() <= Date.now(),
      message: 'La fecha de la asistencia no puede ser futura',
    },
  },
  // Día calendario (America/Argentina, YYYY-MM-DD) del check-in — solo se
  // completa para muro_libre con socio. Respalda el índice único de abajo
  // (appcarc-backend#121): el chequeo de duplicado en memoria de
  // registrarMuroLibre.service.js es un read-then-write sin aislamiento
  // real entre transacciones concurrentes.
  diaCheckin: { type: String, default: null },

  // muro_libre
  tipoPase: { type: String, default: null },
  estadoPago: { type: String, default: null, index: true },
  monto: { type: Number, default: 0, min: 0 },
  precioSugeridoSnapshot: { type: Number, default: null },
  precioCodigo: { type: String, default: '' },
  periodo: { type: String, default: '', match: /^$|^\d{4}-(0[1-9]|1[0-2])$/, index: true },
  formaPago: { type: String, default: null },
  movimientoId: { type: mongoose.Schema.Types.ObjectId, ref: 'Movimiento', default: null },
  cobroId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cobro', default: null },
  enviarComprobanteWp: { type: Boolean, default: false },

  // escuelita
  categoria: { type: String, default: '' },

  // check-in
  scannedBy: { type: String, default: null },
  checkinMethod: { type: String, enum: ['QR', 'DNI', 'MANUAL', 'SELF'], default: 'MANUAL' },

  advertencias: {
    type: [{
      codigo: { type: String, required: true },
      mensaje: { type: String, required: true },
    }],
    default: [],
  },

  observaciones: { type: String, default: '' },
  // Por qué una visita quedó exenta (ej. 'plan_clases'): permite contar los pases
  // incluidos de la semana sin mezclar otras exenciones.
  motivoExento: { type: String, default: '' },
  createdBy: { type: String, required: true },
  updatedBy: { type: String, required: true },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

// Un socio no puede tener dos check-ins de muro_libre activos el mismo día
// calendario — respaldo a nivel de base del chequeo en memoria (que sigue
// existiendo por el mensaje de error amigable, pero no alcanza solo bajo
// transacciones concurrentes).
asistenciaSchema.index(
  { clubId: 1, socioId: 1, tipo: 1, diaCheckin: 1, active: 1 },
  {
    unique: true,
    partialFilterExpression: {
      socioId: { $type: 'objectId' },
      tipo: 'muro_libre',
      diaCheckin: { $type: 'string' },
      active: true,
    },
  },
);

const Asistencia = mongoose.model('Asistencia', asistenciaSchema);

export default Asistencia;
