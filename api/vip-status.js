// api/vip-status.js
// Consulta o status VIP de um usuário. Roda no servidor para poder usar a
// service role key (a tabela vip_status tem RLS liberando SELECT só para o
// próprio usuário via anon key, mas manter a leitura centralizada aqui
// facilita trocar a lógica depois sem tocar no client).
//
// Uso no front-end:
//   GET /api/vip-status?userId=<uuid>

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';

module.exports = async function handler(req, res) {
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

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada nas env vars da Vercel' });
    return;
  }

  const userId = (req.query.userId || '').trim();
  if (!userId) {
    res.status(400).json({ error: 'Informe "userId".' });
    return;
  }

  try {
    const url = `${SUPABASE_URL}/rest/v1/vip_status?user_id=eq.${encodeURIComponent(userId)}&select=expires_at,plan_label`;
    const r = await fetch(url, {
      headers: {
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
      },
    });
    const rows = await r.json();
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;

    if (!row) {
      res.status(200).json({ isVip: false, expiresAt: null, planLabel: null });
      return;
    }

    const isVip = new Date(row.expires_at).getTime() > Date.now();
    res.status(200).json({
      isVip,
      expiresAt: row.expires_at,
      planLabel: row.plan_label || null,
    });
  } catch (err) {
    console.error('vip-status error:', err);
    res.status(502).json({ error: 'Falha ao consultar status VIP.', detail: String(err) });
  }
};
