import InstagramConfig from '../models/InstagramConfig.js';

const GRAPH_BASE = 'https://graph.instagram.com';

// Los tokens de Instagram (Instagram Login) duran 60 días y solo se pueden
// refrescar una vez pasadas 24hs desde que se emitieron/refrescaron.
export const refreshInstagramToken = async (clubId) => {
  const config = await InstagramConfig.findOne({ clubId });
  if (!config) throw new Error('Instagram no está configurado para este club');

  const url = `${GRAPH_BASE}/refresh_access_token?grant_type=ig_refresh_token&access_token=${config.accessToken}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error refrescando token de Instagram (${response.status}): ${body}`);
  }

  const { access_token: accessToken, expires_in: expiresIn } = await response.json();

  config.accessToken = accessToken;
  config.tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
  await config.save();

  return config;
};
