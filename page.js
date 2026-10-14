require('../lib/tz');
const fs = require('fs');
const path = require('path');
const { validarSessao } = require('../lib/auth');
const { ehPerfilNIR, ehPerfilAdministrativo } = require('../lib/regras');
const shell = require('../lib/shell');

const VIEWS = path.join(process.cwd(), 'views');
const cache = {};
const carregar = n => (cache[n] = cache[n] || fs.readFileSync(path.join(VIEWS, n + '.html'), 'utf8'));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TITULOS = { login: 'Natus - Login', nir: 'Natus - Painel NIR/SAME', dashboardgeral: 'Dashboard Geral - Natus', historico: 'Natus - Histórico de Pacientes' };

const ATIVO = { painel: 'painel', dashboard: 'dashboard', nir: 'nir', historico: 'historico', dashboardgeral: 'dashboardgeral' };
const EXTRA = { painel: '\n  <script defer src="/natus-painel.js?v=__V__"></script>' };

/* Placeholders dos views: <!--@head-->, <!--@rail-->, <!--@useractions-->; e as variáveis <?!= nome ?>. */
function render(nome, vars, titulo, ctx) {
  let html = carregar(nome);
  const extra = EXTRA[nome] ? EXTRA[nome].replace('__V__', shell.versao('natus-painel.js')) : '';
  html = html.replace('<!--@head-->', () => shell.head(extra));
  if (ctx) {
    html = html.replace('<!--@rail-->', () => shell.rail({ ativo: ATIVO[nome], token: vars.token, adm: ctx.adm, nir: ctx.nir, setor: vars.setorParam || (ctx.nir ? 'UTIN 1' : ctx.setor), nome: vars.nomeUsuario }));
    html = html.replace('<!--@useractions-->', () => shell.userActions({ nome: vars.nomeUsuario, perfil: vars.perfilUsuario, setor: ctx.nir ? '' : ctx.setor }));
  }
  html = html.replace(/<\?!=\s*(\w+)\s*\?>/g, (_, k) => esc(vars[k]));
  if (titulo) html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(titulo)}</title>`);
  return html;
}

module.exports = async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');   // o token trafega na URL: nunca vaza em Referer
  try {
    const q = req.query || {};
    const view = String(q.view || ''), token = String(q.token || '');
    const sessao = token ? await validarSessao(token) : null;
    const appUrl = '/';
    if (!sessao) return res.status(200).send(render('login', { appUrl }));

    const base = { token, appUrl, nomeUsuario: sessao.nome, perfilUsuario: sessao.perfil, setorUsuario: sessao.setor || '' };
    const adm = ehPerfilAdministrativo(sessao.perfil), nir = ehPerfilNIR(sessao.perfil);
    const setorDe = padrao => (nir ? (String(q.setor || padrao).trim() || padrao) : sessao.setor);
    const ctx = { adm, nir, setor: sessao.setor || '' };
    const painel = setor => res.send(render('painel', { ...base, setorParam: setor }, `Natus - ${setor}`, ctx));

    if (view === 'dashboard') { const s = setorDe('UTIN 1'); return res.send(render('dashboard', { ...base, setorParam: s }, `Natus - Dashboard - ${s}`, ctx)); }
    if (view === 'painel') return painel(setorDe('UTIN 1'));
    if (view === 'nir' || view === 'usuarios') return adm ? res.send(render('nir', base, TITULOS.nir, ctx)) : painel(sessao.setor);
    if (view === 'historico') return res.send(render('historico', base, TITULOS.historico, ctx));
    if (view === 'dashboardgeral') return adm ? res.send(render('dashboardgeral', base, TITULOS.dashboardgeral, ctx)) : painel(sessao.setor);
    if (adm && !q.setor) return res.send(render('nir', base, TITULOS.nir, ctx));
    return painel(adm ? (String(q.setor || 'UTIN 1').trim() || 'UTIN 1') : sessao.setor);
  } catch (e) {
    console.error('[page] erro:', e);
    res.status(500).send('<h3>Erro interno. Tente novamente em instantes.</h3>');
  }
};
