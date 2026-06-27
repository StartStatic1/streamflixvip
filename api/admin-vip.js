// api/admin-vip.js
// API de admin VIP — roda no servidor (Vercel), protegida por email autorizado.
// Operações: listar códigos, criar códigos, desativar código.

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';
const ADMIN_EMAIL  = 'xfdapx@gmail.com';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' }); return; }

  // Verificar token do usuário logado
  const authHeader = req.headers['authorization'] || '';
  const userToken  = authHeader.replace('Bearer ', '').trim();
  if (!userToken) { res.status(401).json({ error: 'Token não fornecido' }); return; }

  // Validar token no Supabase e checar email
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${userToken}` }
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Token inválido' }); return; }
  const userJson = await userRes.json();
  const email = userJson?.email || '';
  if (email !== ADMIN_EMAIL) { res.status(403).json({ error: 'Acesso negado' }); return; }

  // Parse body
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) { body = {}; } }

  const action = body?.action;
  const svcHeaders = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
  };

  // ── LIST ──
  if (action === 'list') {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_codes?select=*&order=created_at.desc&limit=200`, { headers: svcHeaders });
    const rows = await r.json();
    res.status(200).json({ codes: rows });
    return;
  }

  // ── CREATE ──
  if (action === 'create') {
    const { codes } = body; // array de { code, duration_hours, plan_label }
    if (!Array.isArray(codes) || codes.length === 0) { res.status(400).json({ error: 'Informe os códigos' }); return; }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_codes`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify(codes),
    });
    const result = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'Erro ao criar', detail: result }); return; }
    res.status(200).json({ created: result });
    return;
  }

  // ── DEACTIVATE ──
  if (action === 'deactivate') {
    const { code } = body;
    if (!code) { res.status(400).json({ error: 'Informe o code' }); return; }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_codes?code=eq.${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({ is_active: false }),
    });
    const result = await r.json();
    res.status(200).json({ updated: result });
    return;
  }

  // ── REACTIVATE ──
  if (action === 'reactivate') {
    const { code } = body;
    if (!code) { res.status(400).json({ error: 'Informe o code' }); return; }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_codes?code=eq.${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({ is_active: true }),
    });
    const result = await r.json();
    res.status(200).json({ updated: result });
    return;
  }

  res.status(400).json({ error: 'Ação inválida' });
};
