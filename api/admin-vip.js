// api/admin-vip.js
// API de admin VIP — roda no servidor (Vercel), protegida por checagem na
// tabela vip_panel_admins (mesma usada pelo painel de filmes/séries —
// painel único, lista única de quem tem acesso administrativo).
// Operações: listar códigos, criar códigos, desativar código.

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';

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

  // Validar token no Supabase
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${userToken}` }
  });
  if (!userRes.ok) { res.status(401).json({ error: 'Token inválido' }); return; }
  const userJson = await userRes.json();
  const userId = userJson?.id;
  if (!userId) { res.status(401).json({ error: 'Token inválido' }); return; }

  // Checa se esse usuário está na lista de admins do painel (mesma tabela
  // usada pelo painel de filmes — um único lugar para autorizar acesso).
  const adminRes = await fetch(
    `${SUPABASE_URL}/rest/v1/vip_panel_admins?id=eq.${encodeURIComponent(userId)}&select=id`,
    { headers: { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` } }
  );
  const adminRows = await adminRes.json();
  if (!adminRes.ok || !Array.isArray(adminRows) || adminRows.length === 0) {
    res.status(403).json({ error: 'Acesso negado' });
    return;
  }

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

  // ── LIST USERS (vip_status: todo mundo que já logou, com ou sem VIP) ──
  if (action === 'list-users') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vip_status?select=user_id,email,name,first_login_at,last_login_at,expires_at,plan_label,last_code_used&order=last_login_at.desc&limit=500`,
      { headers: svcHeaders }
    );
    const rows = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'Erro ao listar usuários', detail: rows }); return; }
    res.status(200).json({ users: rows });
    return;
  }

  // ── LIST REDEMPTIONS (histórico de códigos usados por um usuário) ──
  if (action === 'list-redemptions') {
    const { userId } = body;
    if (!userId) { res.status(400).json({ error: 'Informe userId' }); return; }
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vip_redemptions?user_id=eq.${encodeURIComponent(userId)}&select=*&order=redeemed_at.desc`,
      { headers: svcHeaders }
    );
    const rows = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'Erro ao listar histórico', detail: rows }); return; }
    res.status(200).json({ redemptions: rows });
    return;
  }

  // ── FILMES/SÉRIES: checa quais tmdb_ids de uma lista já têm fonte cadastrada ──
  if (action === 'list-sources-for') {
    const { mediaType, ids } = body;
    if (!mediaType || !Array.isArray(ids) || ids.length === 0) {
      res.status(200).json({ ids: [] });
      return;
    }
    const idsParam = ids.join(',');
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vip_sources?media_type=eq.${encodeURIComponent(mediaType)}&tmdb_id=in.(${idsParam})&select=tmdb_id`,
      { headers: svcHeaders }
    );
    const rows = await r.json();
    if (!r.ok) { res.status(200).json({ ids: [] }); return; }
    res.status(200).json({ ids: (rows || []).map(x => x.tmdb_id) });
    return;
  }

  // ── FILMES/SÉRIES: lista todas as fontes cadastradas (pro painel) ──
  if (action === 'list-sources') {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/vip_sources?select=id,tmdb_id,media_type,season,episode,title,poster_path,source_url,source_label,priority,is_active,created_at&order=created_at.desc&limit=300`,
      { headers: svcHeaders }
    );
    const rows = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'Erro ao listar fontes', detail: rows }); return; }
    res.status(200).json({ sources: rows });
    return;
  }

  // ── FILMES/SÉRIES: cria nova fonte ──
  if (action === 'create-source') {
    const { tmdb_id, media_type, title, poster_path, season, episode, source_url, source_label, priority } = body;
    if (!tmdb_id || !media_type || !source_url) {
      res.status(400).json({ error: 'Dados incompletos para criar a fonte' });
      return;
    }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_sources`, {
      method: 'POST',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({
        tmdb_id, media_type, title, poster_path, season, episode,
        source_url, source_label, priority, created_by: userId,
      }),
    });
    const result = await r.json();
    if (!r.ok) {
      const msg = JSON.stringify(result).includes('duplicate') ? 'duplicate key' : (result?.message || 'Erro ao criar fonte');
      res.status(409).json({ error: msg, detail: result });
      return;
    }
    res.status(200).json({ created: result });
    return;
  }

  // ── FILMES/SÉRIES: atualiza fonte existente ──
  if (action === 'update-source') {
    const { sourceId, season, episode, source_url, source_label, priority } = body;
    if (!sourceId) { res.status(400).json({ error: 'Informe sourceId' }); return; }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_sources?id=eq.${encodeURIComponent(sourceId)}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({ season, episode, source_url, source_label, priority }),
    });
    const result = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'Erro ao atualizar fonte', detail: result }); return; }
    res.status(200).json({ updated: result });
    return;
  }

  // ── FILMES/SÉRIES: ativa/desativa fonte ──
  if (action === 'toggle-source') {
    const { sourceId, isActive } = body;
    if (!sourceId) { res.status(400).json({ error: 'Informe sourceId' }); return; }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_sources?id=eq.${encodeURIComponent(sourceId)}`, {
      method: 'PATCH',
      headers: { ...svcHeaders, 'Prefer': 'return=representation' },
      body: JSON.stringify({ is_active: !!isActive }),
    });
    const result = await r.json();
    if (!r.ok) { res.status(502).json({ error: 'Erro ao atualizar fonte', detail: result }); return; }
    res.status(200).json({ updated: result });
    return;
  }

  // ── FILMES/SÉRIES: exclui fonte ──
  if (action === 'delete-source') {
    const { sourceId } = body;
    if (!sourceId) { res.status(400).json({ error: 'Informe sourceId' }); return; }
    const r = await fetch(`${SUPABASE_URL}/rest/v1/vip_sources?id=eq.${encodeURIComponent(sourceId)}`, {
      method: 'DELETE',
      headers: svcHeaders,
    });
    if (!r.ok) { const detail = await r.text(); res.status(502).json({ error: 'Erro ao excluir fonte', detail }); return; }
    res.status(200).json({ success: true });
    return;
  }

  res.status(400).json({ error: 'Ação inválida' });
};
