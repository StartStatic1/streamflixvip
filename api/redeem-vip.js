// api/redeem-vip.js
// Resgate de código VIP — roda no servidor (Vercel), nunca no client.
//
// Motivo de existir no servidor: validar e marcar um código como "usado"
// precisa ser uma operação atômica e confiável. Se isso fosse feito direto
// do client com a anon key, qualquer pessoa poderia ler a tabela vip_codes
// inteira (todos os códigos) e usar qualquer um, ou re-aplicar um código já
// usado. Aqui a service role key fica só no servidor e o client nunca vê
// nem os códigos de outros usuários nem a chave.
//
// Uso no front-end:
//   POST /api/redeem-vip   body: { code: "SFV-30D-XXXX", userId: "<uuid>" }
//
// Configuração necessária na Vercel:
//   Settings > Environment Variables > SUPABASE_SERVICE_ROLE_KEY = <service role key>
//   (a SUPABASE_URL já é pública e está hardcoded no front-end também)

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada nas env vars da Vercel' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  const code = (body?.code || '').trim();
  const userId = (body?.userId || '').trim();

  if (!code || !userId) {
    res.status(400).json({ error: 'Informe "code" e "userId".' });
    return;
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  try {
    // 1) Busca o código
    const lookupUrl = `${SUPABASE_URL}/rest/v1/vip_codes?code=eq.${encodeURIComponent(code)}&select=*`;
    const lookupRes = await fetch(lookupUrl, { headers });
    const rows = await lookupRes.json();

    if (!lookupRes.ok || !Array.isArray(rows) || rows.length === 0) {
      res.status(404).json({ error: 'Código inválido.' });
      return;
    }

    const vipCode = rows[0];

    if (!vipCode.is_active) {
      res.status(410).json({ error: 'Este código foi desativado.' });
      return;
    }
    if (vipCode.used_by) {
      res.status(409).json({ error: 'Este código já foi utilizado.' });
      return;
    }

    const now = new Date();
    const durationHours = Number(vipCode.duration_hours) || 0;
    if (durationHours <= 0) {
      res.status(400).json({ error: 'Código com duração inválida.' });
      return;
    }

    // 2) Busca status VIP atual do usuário (se já é VIP, soma a partir do
    //    maior entre "agora" e a expiração atual, em vez de sobrescrever —
    //    assim resgatar um código novo estende o VIP em vez de encurtar)
    const statusUrl = `${SUPABASE_URL}/rest/v1/vip_status?user_id=eq.${encodeURIComponent(userId)}&select=*`;
    const statusRes = await fetch(statusUrl, { headers });
    const statusRows = await statusRes.json();
    const currentStatus = Array.isArray(statusRows) && statusRows.length ? statusRows[0] : null;

    const currentExpiry = currentStatus?.expires_at ? new Date(currentStatus.expires_at) : null;
    const baseTime = (currentExpiry && currentExpiry > now) ? currentExpiry : now;
    const newExpiry = new Date(baseTime.getTime() + durationHours * 60 * 60 * 1000);

    // 3) Marca o código como usado (condicionalmente: só se ainda não tinha used_by,
    //    evitando corrida entre duas requisições simultâneas com o mesmo código)
    const claimUrl = `${SUPABASE_URL}/rest/v1/vip_codes?code=eq.${encodeURIComponent(code)}&used_by=is.null`;
    const claimRes = await fetch(claimUrl, {
      method: 'PATCH',
      headers: { ...headers, 'Prefer': 'return=representation' },
      body: JSON.stringify({ used_by: userId, used_at: now.toISOString() }),
    });
    const claimedRows = await claimRes.json();

    if (!claimRes.ok || !Array.isArray(claimedRows) || claimedRows.length === 0) {
      // Outra requisição já reivindicou o código entre o passo 1 e o passo 3
      res.status(409).json({ error: 'Este código já foi utilizado.' });
      return;
    }

    // 4) Upsert do status VIP do usuário
    const upsertRes = await fetch(`${SUPABASE_URL}/rest/v1/vip_status`, {
      method: 'POST',
      headers: { ...headers, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({
        user_id: userId,
        expires_at: newExpiry.toISOString(),
        plan_label: vipCode.plan_label || null,
        last_code_used: code,
        updated_at: now.toISOString(),
      }),
    });

    if (!upsertRes.ok) {
      const errText = await upsertRes.text();
      console.error('vip_status upsert error:', errText);
      res.status(502).json({ error: 'Código validado, mas falhou ao ativar o VIP. Contate o suporte.' });
      return;
    }

    // 5) Log no histórico de resgates (vip_redemptions) — não bloqueia a
    //    resposta nem desfaz o que já foi feito acima; é só telemetria
    //    pro super painel mostrar o histórico completo de cada usuário.
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/vip_redemptions`, {
        method: 'POST',
        headers: { ...headers, 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          user_id: userId,
          email: currentStatus?.email || null,
          code,
          plan_label: vipCode.plan_label || null,
          duration_hours: durationHours,
          redeemed_at: now.toISOString(),
        }),
      });
    } catch (logErr) {
      console.warn('vip_redemptions log error (non-fatal):', logErr);
    }

    res.status(200).json({
      success: true,
      expiresAt: newExpiry.toISOString(),
      planLabel: vipCode.plan_label || null,
    });
  } catch (err) {
    console.error('redeem-vip error:', err);
    res.status(502).json({ error: 'Falha ao processar o código.', detail: String(err) });
  }
};
