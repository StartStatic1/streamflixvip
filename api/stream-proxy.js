// /api/stream-proxy.js
//
// Resolve o bloqueio de "mixed content": navegadores recusam carregar
// conteúdo http:// dentro de uma página https://. Provedores Xtream
// costumam servir mp4/m3u8 só em http://, então este endpoint busca o
// vídeo no servidor de origem e devolve pelo seu domínio https.
//
// Uso no frontend:
//   <video src="https://seu-site.vercel.app/api/stream-proxy?url=ENCODED_URL"></video>
//
// IMPORTANTE: troque ALLOWED_HOSTS pelos domínios reais dos seus provedores
// Xtream antes de publicar. Sem essa lista, qualquer pessoa poderia usar
// seu proxy pra buscar qualquer URL (abuso de banda/anonimização de tráfego).

const ALLOWED_HOSTS = [
  'unitvlite.xyz',
  'sventank.com',
  'cdnbr02.com', 
  // adicione aqui os domínios dos seus outros provedores Xtream
];

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

  if (!ALLOWED_HOSTS.includes(target.hostname)) {
    res.status(403).json({ error: 'Domínio não autorizado neste proxy.' });
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
