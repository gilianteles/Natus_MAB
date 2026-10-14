const crypto = require('crypto');
const { query, transacao } = require('./db');
const { registrarLog } = require('./log');
const R = require('./regras');
const U = require('./util');
const S = v => String(v == null ? '' : v).trim();

const SESSAO_HORAS = Number(process.env.SESSION_HOURS || 12);

/* ---------- senhas: scrypt com sal; aceita (e migra) o sha256 legado da planilha ---------- */
function hashSenha(senha) {
  const sal = crypto.randomBytes(16);
  const h = crypto.scryptSync(String(senha), sal, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${sal.toString('hex')}$${h.toString('hex')}`;
}
function sha256Legado(senha) { return 'sha256$' + crypto.createHash('sha256').update(String(senha == null ? '' : senha), 'utf8').digest('hex'); }
function conferirSenha(senha, armazenado) {
  const a = S(armazenado);
  if (a.startsWith('scrypt$')) {
    const [, salHex, hHex] = a.split('$');
    const h = crypto.scryptSync(String(senha), Buffer.from(salHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    const esperado = Buffer.from(hHex, 'hex');
    return esperado.length === h.length && crypto.timingSafeEqual(h, esperado);
  }
  if (/^sha256\$[a-f0-9]{64}$/i.test(a)) {
    const x = Buffer.from(sha256Legado(senha).toLowerCase()), y = Buffer.from(a.toLowerCase());
    return x.length === y.length && crypto.timingSafeEqual(x, y);
  }
  return false;
}

/* ---------- login / sessão ---------- */
async function autenticar(ctx, nome, senha) {
  nome = S(nome);
  if (!nome || !senha) throw new Error('Nome ou senha inválidos.');
  // limite de tentativas: 8 falhas em 15 min para o mesmo nome
  const falhas = (await query(`SELECT count(*)::int n FROM logs WHERE acao='LOGIN_FALHA' AND lower(usuario)=lower($1) AND data_hora > now() - interval '15 minutes'`, [nome])).rows[0].n;
  if (falhas >= 8) throw new Error('Muitas tentativas. Aguarde alguns minutos e tente novamente.');

  const { rows } = await query('SELECT nome, perfil, setor, senha_hash FROM usuarios WHERE lower(nome)=lower($1)', [nome]);
  const user = rows[0];
  if (!user || !conferirSenha(senha, user.senha_hash)) {
    await registrarLog(null, nome, 'LOGIN_FALHA', 'Tentativa de login inválida.');
    throw new Error('Nome ou senha inválidos.');
  }
  if (!user.senha_hash.startsWith('scrypt$')) {
    await query('UPDATE usuarios SET senha_hash=$2 WHERE lower(nome)=lower($1)', [user.nome, hashSenha(senha)]);
  }
  const token = U.uuid();
  await query(`INSERT INTO sessoes (token, nome, perfil, setor, expira_em) VALUES ($1,$2,$3,$4, now() + ($5 || ' hours')::interval)`,
    [token, user.nome, user.perfil, user.setor || '', String(SESSAO_HORAS)]);
  query('DELETE FROM sessoes WHERE expira_em < now()').catch(() => {});
  await registrarLog(null, user.nome, 'LOGIN', 'Usuário realizou login no sistema.');
  return { token, nome: user.nome, perfil: user.perfil, setor: user.setor || '' };
}

async function validarSessao(token) {
  if (!token) return null;
  const { rows } = await query('SELECT nome, perfil, setor FROM sessoes WHERE token=$1 AND expira_em > now()', [String(token)]);
  return rows[0] ? { nome: rows[0].nome, perfil: S(rows[0].perfil), setor: rows[0].setor || '' } : null;
}

async function encerrarSessao(ctx, token) {
  const { rows } = await query('DELETE FROM sessoes WHERE token=$1 RETURNING nome', [String(token || '')]);
  if (rows[0]) await registrarLog(null, rows[0].nome, 'LOGOUT', 'Sessão encerrada.');
  return { success: true };
}

/* ---------- autorização ---------- */
function exigirAdministrativo(ctx) {
  if (!ctx.sessao || !R.ehPerfilAdministrativo(ctx.sessao.perfil)) throw new Error('Acesso restrito aos perfis NIR/SAME.');
}
function podeAcessarSetor(sessao, setor) {
  if (!sessao) return false;
  if (R.ehPerfilNIR(sessao.perfil)) return true;
  return U.igual(sessao.setor, setor);
}
function exigirSetor(ctx, setor) {
  if (!podeAcessarSetor(ctx.sessao, setor)) throw new Error('Você não tem acesso a este setor.');
}

/* ---------- gestão de usuários (NIR/SAME) ---------- */
async function obterUsuariosAdministrativos(ctx) {
  exigirAdministrativo(ctx);
  const { rows } = await query('SELECT nome, perfil, setor FROM usuarios ORDER BY nome');
  return rows.map(u => ({ nome: S(u.nome), perfil: S(u.perfil), setor: S(u.setor) }));
}
async function obterSetoresParaUsuario(ctx) {
  exigirAdministrativo(ctx);
  return (await query('SELECT nome_setor FROM setores ORDER BY nome_setor')).rows.map(r => r.nome_setor);
}
async function salvarUsuario(ctx, dados) {
  exigirAdministrativo(ctx);
  const nome = S(dados && dados.nome), perfil = S(dados && dados.perfil), setor = S(dados && dados.setor), senha = S(dados && dados.senha);
  if (!nome || !perfil || !setor || !senha) throw new Error('Preencha Nome, Perfil, Setor e Senha.');
  if (!R.PERFIS_ADMINISTRATIVOS.includes(perfil.toUpperCase()) && perfil.toUpperCase() !== 'SETOR') throw new Error('Perfil inválido.');
  if (senha.length < 6) throw new Error('A senha deve ter ao menos 6 caracteres.');
  const h = hashSenha(senha);
  const r = await query(`INSERT INTO usuarios (nome, perfil, setor, senha_hash) VALUES ($1,$2,$3,$4)
    ON CONFLICT (lower(nome)) DO UPDATE SET nome=EXCLUDED.nome, perfil=EXCLUDED.perfil, setor=EXCLUDED.setor, senha_hash=EXCLUDED.senha_hash
    RETURNING (xmax = 0) AS criado`, [nome, perfil, setor, h]);
  await query('DELETE FROM sessoes WHERE lower(nome)=lower($1) AND lower(nome)<>lower($2)', [nome, ctx.sessao.nome]);
  await registrarLog(null, ctx.sessao.nome, r.rows[0].criado ? 'CRIAR_USUARIO' : 'EDITAR_USUARIO', `Usuário ${nome} / Perfil ${perfil} / Setor ${setor}.`);
  return { success: true };
}
async function excluirUsuario(ctx, nome) {
  exigirAdministrativo(ctx);
  const alvo = S(nome);
  if (!alvo) throw new Error('Usuário não informado.');
  if (U.igual(alvo, ctx.sessao.nome)) throw new Error('O usuário conectado não pode excluir a própria conta.');
  const r = await query('DELETE FROM usuarios WHERE lower(nome)=lower($1) RETURNING nome', [alvo]);
  if (!r.rowCount) throw new Error('Usuário não encontrado.');
  await query('DELETE FROM sessoes WHERE lower(nome)=lower($1)', [alvo]);
  await registrarLog(null, ctx.sessao.nome, 'EXCLUIR_USUARIO', `Usuário ${alvo} excluído.`);
  return { success: true };
}

module.exports = { hashSenha, conferirSenha, autenticar, validarSessao, encerrarSessao, exigirAdministrativo, exigirSetor, podeAcessarSetor,
  obterUsuariosAdministrativos, obterSetoresParaUsuario, salvarUsuario, excluirUsuario };
