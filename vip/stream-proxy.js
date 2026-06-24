/**
 * stream-proxy.js — Vercel Serverless Function
 * 
 * Faz proxy de streams http:// para evitar mixed content em sites https://.
 * Suporta MP4, M3U8, TS e outros formatos de vídeo direto.
 * 
 * Uso: /api/stream-proxy?url=http://servidor:porta/video.mp4
 */

module.exports = async function handler(req, res) {
  // CORS — só permite requisições do próprio site
  const origin = req.headers.origin || '';
  const allowedOrigins = [
    'https://streamflixvip.vercel.app',
    'https://reamflixvip.vercel.app',
    'http://localhost:3000',
    'http://localhost:5500',
  ];
  // Aceita qualquer subdomínio .vercel.app do projeto
  if (allowedOrigins.includes(origin) || /\.vercel\.app$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const { url } = req.query;
  if (!url) {
    res.status(400).json({ error: 'Parâmetro ?url= obrigatório' });
    return;
  }

  // Validação: só faz proxy de URLs de vídeo válidas
  let target;
  try {
    target = new URL(url);
  } catch {
    res.status(400).json({ error: 'URL inválida' });
    return;
  }

  // Bloqueia acesso a IPs internos/privados
  const hostname = target.hostname;
  const isPrivate = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(hostname);
  if (isPrivate) {
    res.status(403).json({ error: 'Acesso a redes privadas não permitido' });
    return;
  }

  // Só deixa passar extensões de vídeo ou sem extensão (streams dinâmicos)
  const path = target.pathname.toLowerCase();
  const isVideoPath = /\.(mp4|m3u8|m3u|ts|mkv|webm|avi|mov)(\?|$)/.test(path) || !path.includes('.');
  if (!isVideoPath) {
    res.status(403).json({ error: 'Tipo de arquivo não permitido' });
    return;
  }

  try {
    const headers = {
      'User-Agent': 'Mozilla/5.0 (compatible; StreamProxy/1.0)',
      'Referer': target.origin,
    };

    // Repassa Range header para suporte a seek em vídeos
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const upstream = await fetch(target.toString(), {
      method: req.method,
      headers,
      redirect: 'follow',
    });

    // Copia headers relevantes da resposta upstream
    const copyHeaders = [
      'content-type', 'content-length', 'content-range',
      'accept-ranges', 'cache-control', 'last-modified',
    ];
    copyHeaders.forEach(h => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });

    res.status(upstream.status);

    // Stream da resposta diretamente ao cliente
    const buffer = await upstream.arrayBuffer();
    res.end(Buffer.from(buffer));

  } catch (err) {
    console.error('[stream-proxy] Erro:', err.message);
    res.status(502).json({ error: 'Erro ao buscar o stream: ' + err.message });
  }
};
