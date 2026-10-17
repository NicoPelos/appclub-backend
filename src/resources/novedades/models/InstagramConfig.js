import mongoose from 'mongoose';

const instagramConfigSchema = new mongoose.Schema({
  clubId: { type: String, required: true, unique: true, index: true },
  igUserId: { type: String, required: true },
  username: { type: String, default: '' },
  accessToken: { type: String, required: true },
  tokenExpiresAt: { type: Date, default: null },
  updatedBy: { type: String, default: 'sistema' },
}, { timestamps: true });

const InstagramConfig = mongoose.model('InstagramConfig', instagramConfigSchema);

export default InstagramConfig;
