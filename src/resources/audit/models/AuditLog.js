import mongoose from 'mongoose';

const auditLogSchema = new mongoose.Schema({
  clubId:    { type: String, required: true, index: true },
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userEmail: { type: String, required: true },
  action:    { type: String, enum: ['CREATE', 'UPDATE', 'DELETE'], required: true },
  resource:  { type: String, required: true, index: true },
  resourceId:{ type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  before:    { type: mongoose.Schema.Types.Mixed, default: null },
  after:     { type: mongoose.Schema.Types.Mixed, default: null },
  endpoint:  { type: String, default: '' },
  ipAddress: { type: String, default: '' },
  revertedAt:{ type: Date, default: null },
  revertedBy:{ type: String, default: null },
}, { timestamps: true });

auditLogSchema.index({ clubId: 1, resource: 1, createdAt: -1 });
auditLogSchema.index({ clubId: 1, userId: 1, createdAt: -1 });

const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
