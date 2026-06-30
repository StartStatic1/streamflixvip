// /api/stream-proxy.js
//
// Resolve o bloqueio de "mixed content": navegadores recusam carregar
// conteúdo http:// dentro de uma página https://. Provedores Xtream
// costumam servir mp4/m3u8 só em http://, então este endpoint busca o
// vídeo no servidor de origem e devolve pelo seu domínio https.
//
// SEGURANÇA: os domínios permitidos são derivados automaticamente da tabela
// vip_sources no Supabase. Qualquer fonte que você cadastrar pelo painel
// admin já libera seu domínio aqui — sem precisar editar código ou fazer
// novo deploy. Cache de 60s em memória evita query ao banco a cada chunk.

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrdWpianB2cGh1dnJlanB2dnR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg2OTQ2OTMsImV4cCI6MjA5NDI3MDY5M30.Zoqdn0V6SZOAfhz9kK9NgG6lniJdyVqihLsNT-O8Huw';

// Hosts extras sempre liberados, mesmo que não estejam em vip_sources ainda.
// Útil pra testes antes de cadastrar no painel.
const EXTRA_ALLOWED_HOSTS = [
  'unitvlite.xyz',
  'sventank.com',
  'cdnbr02.com',
];

let _hostsCache = { hosts: new Set(EXTRA_ALLOWED_HOSTS), fetchedAt: 0 };
const CACHE_TTL_MS = 60 * 1000;

async function getAllowedHosts() {
  const now = Date.now();
  if (now - _hostsCache.fetchedAt < CACHE_TTL_MS) return _hostsCache.hosts;
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vip_sources?select=source_url&is_active=eq.true`,
      { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
    );
    if (r.ok) {
      const rows = await r.json();
      const hosts = new Set(EXTRA_ALLOWED_HOSTS);
      for (const row of rows) {
        try { hosts.add(new URL(row.source_url).hostname); } catch (_) {}
      }
      _hostsCache = { hosts, fetchedAt: now };
    }
  } catch (e) {
    console.error('stream-proxy: falha ao atualizar hosts, mantendo cache:', e);
  }
  return _hostsCache.hosts;
}

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url) {
    res.status(400).json({ error: 'Parâmetro "url" obrigatório.' });
    return;
  }

  let target;
  try {
    target = new URL(url);
  } catch (e) {
    res.status(400).json({ error: 'URL inválida.' });
    return;
  }

  const allowedHosts = await getAllowedHosts();
  if (!allowedHosts.has(target.hostname)) {
    res.status(403).json({ error: 'Domínio não autorizado. Cadastre a fonte no painel admin primeiro.' });
    return;
  }

  try {
    // repassa o header Range, essencial para permitir avançar/retroceder no player
    const forwardHeaders = {};
    if (req.headers.range) forwardHeaders.range = req.headers.range;

    const upstream = await fetch(target.toString(), { headers: forwardHeaders });

    if (!upstream.ok && upstream.status !== 206) {
      res.status(upstream.status).json({ error: 'Servidor de origem retornou erro: ' + upstream.status });
      return;
    }

    // repassa os headers relevantes pro player entender duração/tipo/range
    res.status(upstream.status);
    const passHeaders = ['content-type', 'content-length', 'content-range', 'accept-ranges'];
    passHeaders.forEach(h => {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    });
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.setHeader('Access-Control-Allow-Origin', '*');

    // IMPORTANTE: repassa o corpo em stream (pipe), sem baixar o arquivo
    // inteiro pra memória antes de responder. Com arrayBuffer() o vídeo
    // inteiro (pode passar de 1-2GB) precisa terminar de baixar do servidor
    // de origem ANTES do navegador receber o primeiro byte — isso estoura
    // o tempo máximo de execução da function (10s no plano Hobby da Vercel)
    // e o limite de memória, e o player fica girando pra sempre. Streaming
    // manda os bytes pro navegador conforme chegam da origem.
    if (upstream.body) {
      const reader = upstream.body.getReader();
      req.on('close', () => reader.cancel().catch(() => {}));
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const ok = res.write(Buffer.from(value));
          if (!ok) await new Promise(resolve => res.once('drain', resolve));
        }
      } finally {
        res.end();
      }
    } else {
      // fallback (ambiente sem suporte a stream do fetch): buffer completo
      const buffer = Buffer.from(await upstream.arrayBuffer());
      res.send(buffer);
    }
  } catch (e) {
    if (!res.headersSent) {
      res.status(502).json({ error: 'Falha ao buscar o vídeo de origem: ' + e.message });
    } else {
      res.end();
    }
  }
}

export const config = {
  api: {
    responseLimit: false, // vídeos costumam passar do limite padrão de resposta da Vercel
  },
};
