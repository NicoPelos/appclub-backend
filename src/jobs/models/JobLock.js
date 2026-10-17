import mongoose from 'mongoose';

// Candado simple respaldado en Mongo (no en memoria) para que dos procesos
// distintos no puedan correr el mismo job en simultáneo — pasa durante un
// redeploy, cuando el contenedor viejo y el nuevo conviven un momento y cada
// uno tiene su propio cron programado (ver appcarc-backend#26).
const jobLockSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  lockedAt: { type: Date, required: true },
});

const JobLock = mongoose.model('JobLock', jobLockSchema);

export default JobLock;
