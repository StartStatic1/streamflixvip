// api/track-login.js
// Registra/atualiza o perfil do usuário (email, nome, primeiro/último login)
// na tabela vip_status, toda vez que alguém loga no site. Roda no servidor
// pra usar a service role key — a tabela vip_status tem RLS restritivo e o
// client não deveria escrever nela diretamente.
//
// Importante: este endpoint NUNCA toca em expires_at, plan_label ou
// last_code_used — só nos campos de identificação/data de login. Resgate
// de código continua sendo feito exclusivamente por redeem-vip.js.
//
// Uso no front-end (chamado em todo SIGNED_IN, login novo ou recorrente):
//   POST /api/track-login   body: { userId, email, name }

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' }); return; }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }

  const userId = (body?.userId || '').trim();
  const email  = (body?.email || '').trim() || null;
  const name   = (body?.name || '').trim() || null;

  if (!userId) { res.status(400).json({ error: 'Informe "userId".' }); return; }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  const now = new Date().toISOString();

  try {
    // Busca se já existe registro pra saber se preserva first_login_at
    const lookupUrl = `${SUPABASE_URL}/rest/v1/vip_status?user_id=eq.${encodeURIComponent(userId)}&select=user_id,first_login_at`;
    const lookupRes = await fetch(lookupUrl, { headers });
    const rows = await lookupRes.json();
    const existing = Array.isArray(rows) && rows.length ? rows[0] : null;

    const payload = {
      user_id: userId,
      email,
      name,
      last_login_at: now,
      first_login_at: existing?.first_login_at || now,
    };

    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/vip_status`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload),
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('track-login upsert error:', errText);
      // Não derruba a experiência do usuário por causa disso — só loga.
      res.status(200).json({ success: false });
      return;
    }

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('track-login error:', err);
    // Mesma lógica: falha aqui nunca deve impedir o login de funcionar.
    res.status(200).json({ success: false });
  }
};
