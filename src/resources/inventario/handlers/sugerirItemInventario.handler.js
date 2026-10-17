import sharp from 'sharp';
import CategoriaInventario from '../models/CategoriaInventario.js';

// Si un modelo está saturado (503/429), se prueba el siguiente.
const MODELOS = [process.env.GEMINI_MODEL, 'gemini-flash-latest', 'gemini-3-flash-preview'].filter(Boolean);
const TIMEOUT_MS = 35000;
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODELO = process.env.GROQ_VISION_MODEL || 'qwen/qwen3.8-27b';
const url = (modelo) => `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

const limpiarTexto = (valor, max) => (typeof valor === 'string' ? valor.trim().slice(0, max) : '');

export const sugerirItemInventarioHandler = async (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(503).json({ message: 'La sugerencia por foto no está configurada en el servidor' });
  if (!req.file) return res.status(400).json({ message: 'No se recibió ninguna imagen' });

  try {
    const categorias = (await CategoriaInventario.find({ clubId: req.user?.clubId, active: true }).select('nombre').lean())
      .map((c) => c.nombre);

    // Una foto de cámara pesa varios MB: alcanza con una versión chica para
    // identificar el objeto, y así la llamada no se pasa del tiempo máximo.
    const imagen = await sharp(req.file.buffer)
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();

    const prompt = [
      'Sos el asistente de inventario de un club de montaña y escalada.',
      'Mirá la foto del objeto y respondé solo con JSON con estas claves:',
      '- "nombre": nombre corto del objeto, en español.',
      `- "categoria": exactamente una de estas opciones, o "" si ninguna encaja: ${JSON.stringify(categorias)}.`,
      '- "descripcion": una o dos frases en español que describan solo el objeto: qué es, para qué sirve, material, color y estado visible. No describas dónde está, la superficie, el fondo ni el entorno.',
    ].join('\n');

    const cuerpo = JSON.stringify({
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: imagen.toString('base64') } },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json' },
    });

    let texto = '';
    const groqKey = process.env.GROQ_API_KEY;
    if (groqKey) {
      try {
        const r = await fetch(GROQ_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({
            model: GROQ_MODELO,
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imagen.toString('base64')}` } },
              ],
            }],
            response_format: { type: 'json_object' },
            max_tokens: 400,
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (r.ok) {
          const data = await r.json();
          texto = data?.choices?.[0]?.message?.content ?? '';
        } else {
          console.error(`Groq respondió ${r.status}, pruebo Gemini`);
        }
      } catch (error) {
        console.error('Groq falló, pruebo Gemini:', error.name);
      }
    }

    let respuesta;
    for (const modelo of texto ? [] : MODELOS) {
      respuesta = await fetch(url(modelo), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-goog-api-key': apiKey },
        body: cuerpo,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (respuesta.status !== 503 && respuesta.status !== 429) break;
      console.error(`Gemini ${modelo} respondió ${respuesta.status}, pruebo el siguiente modelo`);
    }

    if (!texto && !respuesta?.ok) {
      console.error('Gemini respondió', respuesta.status);
      return res.status(502).json({ message: 'No se pudo obtener la sugerencia en este momento' });
    }

    if (!texto) {
      const data = await respuesta.json();
      texto = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    }
    let propuesta;
    try {
      propuesta = JSON.parse(texto);
    } catch {
      return res.status(502).json({ message: 'La sugerencia llegó en un formato que no se pudo leer' });
    }

    const categoria = typeof propuesta.categoria === 'string' && categorias.includes(propuesta.categoria) ? propuesta.categoria : '';
    res.status(200).json({
      nombre: limpiarTexto(propuesta.nombre, 80),
      categoria,
      descripcion: limpiarTexto(propuesta.descripcion, 300),
    });
  } catch (error) {
    console.error('Error sugiriendo ítem de inventario:', error);
    res.status(502).json({ message: 'No se pudo obtener la sugerencia en este momento' });
  }
};

export default sugerirItemInventarioHandler;
