import jwt from 'jsonwebtoken';

let redisClient = null;
let usingRedis = false;

// Lazy init Redis client if REDIS_URL is provided
async function initRedis() {
  if (usingRedis || !process.env.REDIS_URL) return;
  try {
    const IORedis = await import('ioredis');
    redisClient = new IORedis.default(process.env.REDIS_URL);
    usingRedis = true;
    redisClient.on('error', (err) => {
      console.error('Redis error, falling back to memory blacklist:', err);
      usingRedis = false;
      redisClient = null;
    });
  } catch (err) {
    console.warn('ioredis not available or failed to init, using in-memory blacklist');
    usingRedis = false;
    redisClient = null;
  }
}

const memorySet = new Set();

export async function addToken(token) {
  await initRedis();
  // Try to compute TTL from token exp claim
  let ttl = 60 * 60 * 8; // default 8h
  try {
    const decoded = jwt.decode(token);
    if (decoded && decoded.exp) {
      const now = Math.floor(Date.now() / 1000);
      const diff = decoded.exp - now;
      if (diff > 0) ttl = diff;
    }
  } catch (e) {
    // ignore
  }

  if (usingRedis && redisClient) {
    try {
      await redisClient.set(`blacklist:${token}`, '1', 'EX', ttl);
      return true;
    } catch (err) {
      console.error('Failed to write token to Redis, falling back to memory:', err);
      memorySet.add(token);
      return false;
    }
  }

  memorySet.add(token);
  return true;
}

export async function hasToken(token) {
  await initRedis();
  if (usingRedis && redisClient) {
    try {
      const res = await redisClient.get(`blacklist:${token}`);
      return !!res;
    } catch (err) {
      console.error('Redis get failed, falling back to memory:', err);
      return memorySet.has(token);
    }
  }
  return memorySet.has(token);
}

export function _clearMemoryBlacklist() {
  // helper for tests
  memorySet.clear();
}

export default {
  addToken,
  hasToken,
  _clearMemoryBlacklist,
};
