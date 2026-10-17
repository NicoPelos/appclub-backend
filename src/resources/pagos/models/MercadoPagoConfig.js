import mongoose from 'mongoose';

const mercadoPagoConfigSchema = new mongoose.Schema({
  clubId: { type: String, required: true, unique: true, index: true },
  accessToken: { type: String, required: true },
  publicKey: { type: String, default: '' },
  webhookSecret: { type: String, default: '' },
  active: { type: Boolean, default: true },
  updatedBy: { type: String, default: 'sistema' },
}, { timestamps: true });

const MercadoPagoConfig = mongoose.model('MercadoPagoConfig', mercadoPagoConfigSchema);

export default MercadoPagoConfig;
