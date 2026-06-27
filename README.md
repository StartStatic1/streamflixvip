#StreamFlixVIP

Site de streaming para monetização via Monetag + EasyVidPlay.

## Estrutura

```
index.html         → Página principal com grid de filmes
privacidade.html   → Política de Privacidade
termos.html        → Termos de Uso
contato.html       → Contato
dmca.html          → DMCA
vercel.json        → Config do Vercel
```

## Deploy no Vercel

1. Suba este repo no GitHub
2. Acesse vercel.com → New Project → importe o repo
3. Clique em Deploy (sem configurar nada extra)

## Apontar domínio (Spaceship → Vercel)

No Vercel: Settings → Domains → adicione `streamflixvip.online`

O Vercel vai te dar os registros DNS. No Spaceship → DNS Avançado, adicione:
- Tipo A → valor que o Vercel indicar (ex: 76.76.21.21)
- CNAME www → cname.vercel-dns.com

## Verificação Monetag

Quando o Monetag enviar o arquivo de verificação (ex: `monetag-verify-abc123.html`):
1. Salve o arquivo nesta pasta
2. Faça commit e push no GitHub
3. Vercel atualiza em ~30 segundos
4. Clique em Verificar no Monetag ✅

## Adicionar mais filmes

No `index.html`, encontre o array `const movies = [...]` e adicione:

```js
{
  id: 10,
  title: "Nome do Filme",
  year: 2024,
  genre: "Ação",
  rating: "⭐ 7.5",
  desc: "Descrição do filme aqui.",
  emoji: "🎬",
  embed: "https://streamflixvip.vidplayer.live/#CODIGO_DO_VIDEO",
  featured: false,
  category: "acao"  // terror | acao | suspense | classico
},
```
