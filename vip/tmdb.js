// api/tmdb.js
// Proxy serverless para a TMDB API.
// Motivo de existir: chamadas client-side direto para api.themoviedb.org
// retornam 403 em produção (e expõem a API key no bundle). Este proxy
// roda no servidor da Vercel, injeta a key a partir de uma env var, e
// repassa a resposta para o front-end.
//
// Uso no front-end:
//   /api/tmdb?path=/movie/12345&append_to_response=images,credits
//
// Configuração necessária na Vercel:
//   Settings > Environment Variables > TMDB_API_KEY = <sua key da TMDB>

const TMDB_BASE = 'https://api.themoviedb.org/3';

module.exports = async function handler(req, res) {
  // CORS básico (não é estritamente necessário já que é same-origin,
  // mas evita dor de cabeça se o front for servido de outro domínio)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'TMDB_API_KEY não configurada nas env vars da Vercel' });
    return;
  }

  const { path, ...rest } = req.query;
  if (!path || typeof path !== 'string' || !path.startsWith('/')) {
    res.status(400).json({ error: 'Parâmetro "path" inválido. Use ex: ?path=/movie/123' });
    return;
  }

  try {
    const url = new URL(TMDB_BASE + path);
    url.searchParams.set('api_key', apiKey);
    if (!rest.language) url.searchParams.set('language', 'pt-BR');

    Object.entries(rest).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });

    const tmdbRes = await fetch(url.toString());
    const data = await tmdbRes.json();

    // Cacheia no edge/CDN da Vercel por 1h, com 24h de stale-while-revalidate
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    res.status(tmdbRes.status).json(data);
  } catch (err) {
    console.error('TMDB proxy error:', err);
    res.status(502).json({ error: 'Falha ao conectar com a TMDB', detail: String(err) });
  }
};
