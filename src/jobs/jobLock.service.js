import JobLock from './models/JobLock.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos — de sobra para cualquier job actual

/**
 * Intenta tomar un candado exclusivo por nombre. Devuelve true si lo obtuvo,
 * false si ya estaba tomado por otra ejecución en curso (y no venció).
 */
export const acquireJobLock = async (name, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const now = new Date();
  const staleThreshold = new Date(now.getTime() - timeoutMs);

  try {
    await JobLock.findOneAndUpdate(
      { _id: name, $or: [{ lockedAt: { $exists: false } }, { lockedAt: { $lt: staleThreshold } }] },
      { $set: { lockedAt: now } },
      { upsert: true },
    );
    return true;
  } catch (error) {
    if (error.code === 11000) return false; // ya lo tiene otra ejecución vigente
    throw error;
  }
};

export const releaseJobLock = async (name) => {
  await JobLock.deleteOne({ _id: name });
};
