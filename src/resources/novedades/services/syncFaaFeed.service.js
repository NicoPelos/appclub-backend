import Parser from 'rss-parser';
import Novedad from '../models/Novedad.js';
import Club from '../../clubs/models/Club.js';

const FAA_FEED_URL = 'https://www.federacionandinistasargentinos.ar/category/noticias/feed/';
const FUENTE_NOMBRE = 'FAA';

const parser = new Parser();

const stripHtml = (html) => (html || '').replace(/<[^>]*>/g, '').trim();

const extractImageUrl = (item) => {
  const html = item['content:encoded'] || item.content || '';
  const matches = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)].map((m) => m[1]);
  // Ignora los iconos de emoji que WordPress inyecta en el contenido — no son
  // la foto real del post.
  return matches.find((src) => !src.includes('s.w.org/images/core/emoji')) ?? null;
};

// Sincroniza el feed RSS de la Federación Andinistas Argentinos (fuente
// pública, sin necesidad de autorización — a diferencia de Instagram, ver
// appcarc-backend#8) hacia los clubes que tengan el módulo de novedades
// habilitado.
export const syncFaaFeed = async () => {
  const feed = await parser.parseURL(FAA_FEED_URL);
  const items = feed.items || [];

  const clubes = await Club.find({ active: true, 'modulos.novedades': true }, 'slug').lean();
  const clubIds = clubes.map((c) => c.slug).filter(Boolean);

  let inserted = 0;
  let skipped = 0;

  for (const clubId of clubIds) {
    for (const item of items) {
      const fuenteId = item.guid || item.link;
      if (!fuenteId) { skipped++; continue; }

      const novedad = {
        clubId,
        fuente: 'rss',
        fuenteId,
        titulo: (item.title || 'Novedad de FAA').slice(0, 200),
        cuerpo: stripHtml(item.contentSnippet || item.content).slice(0, 500),
        imagenUrl: extractImageUrl(item),
        linkOriginal: item.link || null,
        categoria: FUENTE_NOMBRE,
        fechaPublicacion: item.pubDate ? new Date(item.pubDate) : new Date(),
        createdBy: 'sync:faa',
      };

      const result = await Novedad.updateOne(
        { clubId, fuenteId },
        { $setOnInsert: novedad },
        { upsert: true },
      );

      if (result.upsertedCount > 0) inserted++;
      else skipped++;
    }
  }

  return { inserted, skipped, total: items.length * clubIds.length };
};

export default syncFaaFeed;
