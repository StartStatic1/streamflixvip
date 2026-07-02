// api/active-ads.js
// Retorna a lista de anúncios ativos para o site exibir, já filtrando por
// tipo/local e por status VIP.
//
// SEGURANÇA: se vier um token de sessão (Authorization: Bearer <jwt>), a
// validade dele é checada direto no Supabase Auth (não confiamos em um
// "sou VIP: true" que o client poderia forjar) e o VIP real do usuário é
// consultado na tabela vip_status. Sem token, ou com token inválido, a
// pessoa é tratada como não-VIP — o que é o comportamento seguro por
// padrão (nunca esconde ads de quem não provou ser VIP).
//
// Uso no frontend:
//   GET /api/active-ads?type=popunder&placement=watch
//   Authorization: Bearer <access_token>   (opcional — omitir = trata como não-VIP)

const SUPABASE_URL = 'https://gkujbjpvphuvrejpvvtz.supabase.co';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) { res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada' }); return; }

  const adType    = (req.query.type || '').trim();
  const placement = (req.query.placement || '').trim();

  try {
    // 1) Descobre se quem está pedindo é VIP de verdade (valida o token no
    //    próprio Supabase Auth, não aceita o dado vindo pronto do client).
    let isVip = false;
    const authHeader = req.headers['authorization'] || '';
    const userToken = authHeader.replace('Bearer ', '').trim();
    if (userToken) {
      const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${userToken}` },
      });
      if (userRes.ok) {
        const userJson = await userRes.json();
        const userId = userJson?.id;
        if (userId) {
          const statusRes = await fetch(
            `${SUPABASE_URL}/rest/v1/vip_status?user_id=eq.${encodeURIComponent(userId)}&select=expires_at`,
            { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
          );
          const statusRows = await statusRes.json();
          const row = Array.isArray(statusRows) && statusRows.length ? statusRows[0] : null;
          isVip = !!row && new Date(row.expires_at).getTime() > Date.now();
        }
      }
    }

    // 2) VIP não recebe nenhum ad — retorna lista vazia sem nem consultar
    //    vip_ads, economizando uma query.
    if (isVip) {
      res.status(200).json({ ads: [], isVip: true });
      return;
    }

    // 3) Busca os ads ativos que batem com o tipo/local pedidos
    let url = `${SUPABASE_URL}/rest/v1/vip_ads?is_active=eq.true&select=id,name,ad_type,content_type,content,placement,priority&order=priority.desc`;
    if (adType) url += `&ad_type=eq.${encodeURIComponent(adType)}`;
    if (placement) url += `&placement=eq.${encodeURIComponent(placement)}`;

    const adsRes = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    const ads = await adsRes.json();

    res.status(200).json({ ads: Array.isArray(ads) ? ads : [], isVip: false });
  } catch (err) {
    console.error('active-ads error:', err);
    // Em caso de falha, devolve lista vazia em vez de erro — um ad que não
    // carrega não deveria quebrar a experiência de assistir.
    res.status(200).json({ ads: [], isVip: false, error: String(err) });
  }
};
