import mongoose from 'mongoose';
import { JOBS } from './runJob.handler.js';

const MONGO_STATES = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

const formatUptime = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
};

export const getHealthHandler = async (req, res) => {
  try {
    const uptime = process.uptime();
    res.status(200).json({
      status: 'ok',
      uptime,
      uptimeHuman: formatUptime(uptime),
      mongoStatus: MONGO_STATES[mongoose.connection.readyState] ?? 'unknown',
      timestamp: new Date().toISOString(),
      jobs: Object.keys(JOBS),
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: error.message });
  }
};
