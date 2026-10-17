import mongoose from 'mongoose';

// Solo tiene sentido (y es obligatoria) para movimientos cargados a mano
// (sourceType: 'manual', vía "Registrar Movimiento") — un cobro o un check-in
// de Muro Libre ya tienen trazabilidad real por etiqueta/asistencia, no
// necesitan que alguien elija una categoría de texto. Distinta lista según
// type porque "Honorarios" no tiene sentido para un ingreso, ni "Viajes"
// para un egreso. Ver issue #55.
// "Eventos" no está como categoría: se solapa con eventoId (ver Evento.js) —
// un ingreso/egreso ligado a un evento ya se distingue por ese tag, no
// necesita además una categoría genérica que no agrega información.
export const CATEGORIAS_MOVIMIENTO = {
  Ingreso: ['Viajes', 'Ventas / Reventa', 'Subsidios / Donaciones', 'Otros'],
  Egreso: ['Honorarios', 'Costos Fijos', 'Varios'],
};

const MovimientoSchema = new mongoose.Schema({
  clubId: {
    type: String,
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  // Quién gestionó/autorizó el movimiento (staff), no a nombre de quién es el ingreso/egreso.
  responsable: {
    type: String,
    required: true,
  },
  // A nombre de quién es el movimiento cuando aplica (ej. socio o visitante de muro libre).
  // Para cobros de cuotas, ver el detalle por socio en GET /api/movimientos.
  socioNombre: {
    type: String,
    default: '',
  },
  // Solo se completa cuando el movimiento corresponde a un único socio (ej. muro libre,
  // o un cobro cuyos items son todos del mismo socio). Si un cobro mezcla varios socios
  // en un mismo movimiento, queda null y hay que ver el detalle por item en GET /api/movimientos.
  socioId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Socio',
    default: null,
    index: true,
  },
  type: {
    type: String,
    enum: ['Ingreso', 'Egreso'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  concept: {
    type: String,
    required: true,
  },
  // Ver CATEGORIAS_MOVIMIENTO más arriba — null para movimientos que no vienen
  // de "Registrar Movimiento" (cobro, muro_libre), obligatoria para los que sí.
  categoria: {
    type: String,
    default: null,
  },
  paymentMethod: {
    type: String,
    enum: ['Efectivo', 'Transferencia', 'MercadoPago'],
    required: true,
  },
  sourceType: {
    type: String,
    enum: ['manual', 'cobro', 'muro_libre', 'evento_participante'],
    default: 'manual',
  },
  sourceId: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'sourceModel',
    default: null,
  },
  sourceModel: {
    type: String,
    enum: ['Cobro', 'Asistencia', 'EventoParticipante'],
    default: null,
  },
  // Evento al que pertenece este movimiento (appcarc-backend#180-182) — no
  // solo los ingresos de un participante (a esos se les setea automático,
  // ver registrarPagoEventoParticipante.service.js), también cualquier otro
  // ingreso/egreso relacionado cargado a mano en Registrar Movimiento (ej.
  // pagarle al proveedor de las remeras de un evento). Independiente de
  // sourceType/sourceModel: un movimiento manual (sourceType:'manual') puede
  // igual tener eventoId seteado.
  eventoId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Evento',
    default: null,
    index: true,
  },
  description: {
    type: String,
    default: '',
  },
  date: {
    type: Date,
    default: Date.now,
  },
  createdBy: {
    type: String,
    required: true,
  },
  updatedBy: {
    type: String,
    required: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  // Fotos de comprobante/ticket, siempre opcional — array (no un solo campo)
  // porque un mismo gasto puede tener varias fotos (ej. ticket de varias
  // páginas). Solo tiene sentido para movimientos manuales, pero no se
  // restringe a nivel de schema (ver uploadComprobante.handler.js).
  comprobantes: {
    type: [{
      url: { type: String, required: true },
      createdBy: { type: String, required: true },
      createdAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
  // Vínculo manual con pagos reales de Mercado Pago — solo tiene sentido
  // para Ingreso + Transferencia (la API de MP solo expone plata que ENTRÓ
  // a la cuenta del club, no egresos/retiros). Array (no un solo objeto)
  // porque un mismo movimiento puede corresponder a más de una transferencia
  // real (ej. alguien que transfiere en 2 partes y se registra como un solo
  // cobro acá). Guarda una foto del pago al momento de vincular en vez de
  // re-consultar la API cada vez que se lista.
  mercadopagoVinculos: {
    type: [{
      paymentId: { type: String, required: true },
      payerEmail: { type: String, default: '' },
      // Nombre del pagador cuando no viene de la API de pagos de MP (que para
      // esta cuenta nunca trae first_name/last_name) sino de una fuente leída
      // a mano: una captura de la vista "Actividad" de MP, o una fila del
      // reporte "Estado de cuenta" — ambas sí muestran el nombre, para
      // ingresos y egresos (appcarc-backend#274). Alimenta el mismo
      // aprendizaje histórico por pagador que el email.
      payerName: { type: String, default: '' },
      monto: { type: Number, required: true },
      fecha: { type: Date, required: true },
      vinculadoPor: { type: String, required: true },
      vinculadoAt: { type: Date, default: Date.now },
    }],
    default: [],
  },
}, {
  timestamps: true,
});

export default mongoose.model('Movimiento', MovimientoSchema);
