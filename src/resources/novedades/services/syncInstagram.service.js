import Novedad from '../models/Novedad.js';
import InstagramConfig from '../models/InstagramConfig.js';

const GRAPH_BASE = 'https://graph.instagram.com';
const MEDIA_FIELDS = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';

const extractImageUrl = (item) => {
  if (item.media_type === 'VIDEO') return item.thumbnail_url || item.media_url || null;
  return item.media_url || null;
};

// Los posts de Instagram no tienen "título" propio, solo un caption. Se usa la
// primera línea como título y el resto como cuerpo, para no repetir el texto.
const splitCaption = (caption) => {
  const lines = (caption || '').trim().split('\n');
  const firstLineIndex = lines.findIndex((line) => line.trim());
  if (firstLineIndex === -1) return { titulo: 'Publicación de Instagram', cuerpo: '' };

  return {
    titulo: lines[firstLineIndex].trim().slice(0, 200),
    cuerpo: lines.slice(firstLineIndex + 1).join('\n').trim(),
  };
};

export const syncInstagramFeed = async ({ clubId }) => {
  if (!clubId) throw new Error('clubId es requerido para la sincronización');

  const config = await InstagramConfig.findOne({ clubId });
  if (!config) throw new Error('Instagram no está configurado para este club');

  const url = `${GRAPH_BASE}/${config.igUserId}/media?fields=${MEDIA_FIELDS}&access_token=${config.accessToken}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Error de Instagram Graph API (${response.status}): ${body}`);
  }

  const { data: items = [] } = await response.json();

  let inserted = 0;
  let skipped = 0;

  for (const item of items) {
    const fuenteId = item.id;
    if (!fuenteId) { skipped++; continue; }

    const { titulo, cuerpo } = splitCaption(item.caption);

    const novedad = {
      clubId,
      fuente: 'instagram',
      fuenteId,
      titulo,
      cuerpo,
      imagenUrl: extractImageUrl(item),
      linkOriginal: item.permalink || null,
      fechaPublicacion: item.timestamp ? new Date(item.timestamp) : new Date(),
      createdBy: 'sync:instagram',
    };

    const result = await Novedad.updateOne(
      { clubId, fuenteId },
      { $setOnInsert: novedad },
      { upsert: true },
    );

    if (result.upsertedCount > 0) inserted++;
    else skipped++;
  }

  return { inserted, skipped, total: items.length };
};
