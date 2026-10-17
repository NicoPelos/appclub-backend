import mongoose from 'mongoose';

// Pagos de Mercado Pago que un staff revisó y decidió que NO corresponde
// vincular a ningún Movimiento (ej. plata de un asado entre socios, donde el
// club adelanta la compra y después cada uno le devuelve su parte por
// transferencia — no es un ingreso real del club). Se marcan acá para que no
// vuelvan a aparecer en la lista de "sin vincular".
const mercadopagoDescartadoSchema = new mongoose.Schema({
  clubId: { type: String, required: true, index: true },
  paymentId: { type: String, required: true },
  motivo: { type: String, default: '' },
  descartadoPor: { type: String, required: true },
}, { timestamps: true });

mercadopagoDescartadoSchema.index({ clubId: 1, paymentId: 1 }, { unique: true });

const MercadopagoDescartado = mongoose.model('MercadopagoDescartado', mercadopagoDescartadoSchema);

export default MercadopagoDescartado;
