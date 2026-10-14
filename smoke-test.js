// Teste de ponta a ponta contra um PostgreSQL real (DATABASE_URL). ATENÇÃO: apaga os dados das tabelas de negócio.
require('../lib/tz');
const assert = require('assert');
const { getPool } = require('../lib/db');
const { hashSenha } = require('../lib/auth');
const { FUNCOES } = require('../lib/rpc');
const { validarSessao } = require('../lib/auth');

const hoje = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
let sess = null;
const call = async (nome, ...a) => FUNCOES[nome]({ sessao: sess }, ...a);
const falha = async (nome, ...a) => { try { await call(nome, ...a); } catch (e) { return e.message; } throw new Error('esperava falha em ' + nome); };
let n = 0; const ok = m => console.log(`  ✔ ${++n}. ${m}`);

(async () => {
  const p = getPool();
  await p.query('TRUNCATE movimentacoes, contato_pele_pele, indicadores_leito, internacoes, pacientes, leitos, setores, usuarios, sessoes, logs RESTART IDENTITY CASCADE');
  for (const s of ['UTIN 1', 'UCINCA', 'ALCON 1', 'UTI MATERNA', 'UEN']) await p.query(`INSERT INTO setores VALUES ($1,$1,'Neonatal',0)`, [s]);
  await p.query(`INSERT INTO usuarios VALUES ('NIR Teste','NIR','NIR',$1)`, [hashSenha('abcdef1')]);
  await p.query(`INSERT INTO usuarios VALUES ('Enf UTIN','SETOR','UTIN 1','sha256$' || encode(sha256('legado1'::bytea),'hex'))`);

  console.log('Autenticação');
  assert.match(await falha('autenticar', 'NIR Teste', 'errada'), /inválidos/); ok('senha errada recusada');
  const login = await call('autenticar', 'nir teste', 'abcdef1'); sess = await validarSessao(login.token); assert.equal(sess.perfil, 'NIR'); ok('login NIR (scrypt)');
  const loginLegado = await call('autenticar', 'Enf UTIN', 'legado1'); assert.ok(loginLegado.token); ok('login legado sha256 aceito');
  assert.match((await p.query(`SELECT senha_hash h FROM usuarios WHERE nome='Enf UTIN'`)).rows[0].h, /^scrypt\$/); ok('hash legado migrado para scrypt');
  const NIR = sess; const ENF = await validarSessao(loginLegado.token);

  console.log('Setores e leitos');
  await call('criarSetor', { nome: 'CCO TESTE', tipo: 'Internação', leitosAtivos: 2 }); ok('criarSetor com 2 leitos');
  assert.match(await falha('criarSetor', { nome: 'cco teste' }), /Já existe/); ok('setor duplicado recusado');
  for (const s of ['UTIN 1', 'UCINCA', 'ALCON 1', 'UTI MATERNA']) for (const l of ['L1', 'L2']) await call('adicionarLeito', s, l);
  assert.match(await falha('adicionarLeito', 'UEN', 'X'), /UEN/); ok('leito manual na UEN recusado');
  sess = ENF;
  assert.match(await falha('adicionarLeito', 'UCINCA', 'Z'), /acesso/); ok('usuário de setor não mexe em outro setor');
  let painel = await call('getPainelOperacionalData', 'UTIN 1'); assert.equal(painel.leitos.length, 2); ok('painel UTIN 1 carregado');
  assert.match(await falha('getPainelOperacionalData', 'UCINCA'), /acesso/); ok('painel de outro setor bloqueado');

  console.log('Admissão e saída (UTIN 1)');
  const l1 = painel.leitos[0].ID_Leito;
  const adm = await call('registrarInternacao', { setor: 'UTIN 1', leitoId: l1, nome: 'RN de Maria', sexo: 'F', dataNascimento: hoje(), procedencia: 'CCO', data: hoje(), hora: '08:00', tipoParto: 'Cesárea', pesoNascer: '<1500', ig: '30s', horaNascimento: '07:10', numeroProntuario: '123' });
  assert.ok(adm.idInternacao); ok('internação registrada');
  assert.match(await falha('registrarInternacao', { setor: 'UTIN 1', leitoId: l1, nome: 'X', dataNascimento: hoje(), procedencia: 'CCO', data: hoje(), hora: '09:00' }), /ocupado/); ok('leito ocupado recusado');
  painel = await call('getPainelOperacionalData', 'UTIN 1');
  assert.equal(painel.resumo.ocupados, 1); assert.equal(painel.resumo.internacoesHoje, 1); assert.equal(painel.resumo.internacoesInternasHoje, 1); ok('KPIs do painel (ocupados=1, internações hoje=1, interna)');
  assert.equal(painel.leitos.find(l => l.ID_Leito === l1).pacienteNome, 'RN de Maria');
  await call('alterarStatusExameExterno', l1, true, ''); ok('exame externo');
  await call('editarInternacao', { idInternacao: adm.idInternacao, idPaciente: painel.leitos.find(l => l.ID_Leito === l1).idPaciente, nome: 'RN de Maria Silva', dataNascimento: hoje(), sexo: 'F', procedencia: 'CCO', tipoParto: 'Cesárea', pesoNascer: '<1500', ig: '31s', horaNascimento: '07:10', numeroProntuario: '123' }); ok('editarInternacao');
  const l2 = painel.leitos[1].ID_Leito;
  await call('trocarLeito', { idInternacao: adm.idInternacao, novoLeitoId: l2 }); ok('trocar leito'); 
  painel = await call('getPainelOperacionalData', 'UTIN 1'); assert.equal(painel.leitos.find(l => l.ID_Leito === l1).Status, 'Livre'); assert.equal(painel.leitos.find(l => l.ID_Leito === l2).Status, 'Ocupado'); ok('origem livre / destino ocupado');
  const r1 = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: adm.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '18:00', aleitamentoExclusivo: 'Sim', etapaCanguru: '2ª etapa' });
  assert.ok(r1.success && r1.painel.resumo.ocupados === 0 && r1.painel.resumo.altasHoje === 1); ok('alta atualiza painel (ocupados=0, altas hoje=1)');
  assert.match(await falha('registrarMovimentacaoAtualizarPainel', { idInternacao: adm.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Alta', data: hoje(), hora: '19:00' }), /não encontrada/); ok('alta duplicada recusada');

  console.log('Transferência UTIN 1 -> UEN (leito virtual) e extinção');
  const adm2 = await call('registrarInternacao', { setor: 'UTIN 1', leitoId: l1, nome: 'RN Beto', sexo: 'M', dataNascimento: hoje(), procedencia: 'PPP', data: hoje(), hora: '10:00' });
  const rt = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: adm2.idInternacao, setorAtual: 'UTIN 1', tipoMovimento: 'Transferencia', destino: 'UEN', data: hoje(), hora: '11:00' });
  assert.ok(rt.transferenciaInterna); ok('transferência para UEN cria leito virtual');
  sess = NIR;
  let uen = await call('getPainelOperacionalData', 'UEN'); assert.equal(uen.leitos.length, 1); assert.equal(uen.leitos[0].Numero_Leito, 'LT Extra-01'); ok('UEN: 1 leito "LT Extra-01"');
  const vz = await call('admitirVagaZeroUEN', { nome: 'RN Vaga Zero', data: hoje(), hora: '12:00', sexo: 'F', gravidade: 'Alta' }); assert.equal(vz.leito, 'LT Extra-02'); ok('vaga zero cria LT Extra-02');
  const uenInt = (await p.query(`SELECT id_internacao FROM internacoes WHERE setor_nome='UEN' AND status='Ativo' ORDER BY data_hora_entrada LIMIT 1`)).rows[0].id_internacao;
  await call('registrarMovimentacaoAtualizarPainel', { idInternacao: uenInt, setorAtual: 'UEN', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '14:00' });
  uen = await call('getPainelOperacionalData', 'UEN'); assert.equal(uen.leitos.length, 1); assert.equal(uen.leitos[0].Numero_Leito, 'LT Extra-01'); ok('UEN: leito extinto na saída e renumerado');

  console.log('ALCON (binômio Mãe + RN)');
  const al = (await call('getPainelOperacionalData', 'ALCON 1')).leitos[0].ID_Leito;
  await call('registrarInternacao', { setor: 'ALCON 1', leitoId: al, tipoPaciente: 'MAE', nome: 'Mãe Ana', dataNascimento: '1995-01-01', procedencia: 'CCO', data: hoje(), hora: '07:00', tipoProcedimento: 'Cesárea' });
  const rnAdm = await call('registrarInternacao', { setor: 'ALCON 1', leitoId: al, tipoPaciente: 'RN', nome: 'RN Ana', sexo: 'F', dataNascimento: hoje(), procedencia: 'CCO', data: hoje(), hora: '07:05', pesoNascer: '≥2500' });
  let a1 = await call('getPainelOperacionalData', 'ALCON 1'); assert.equal(a1.resumo.ocupados, 1); assert.equal(a1.internadosAtivos.length, 2); assert.equal(a1.resumo.internacoesHoje, 1); ok('binômio ocupa 1 leito, 2 internados, 1 internação hoje');
  const maeInt = (await p.query(`SELECT id_internacao FROM internacoes WHERE setor_nome='ALCON 1' AND tipo_paciente='MAE'`)).rows[0].id_internacao;
  const ra = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: maeInt, setorAtual: 'ALCON 1', tipoMovimento: 'Alta', destino: 'Domiciliar', data: hoje(), hora: '16:00' });
  assert.ok(ra.altaMaeMantemRN); a1 = ra.painel; assert.equal(a1.resumo.ocupados, 1); assert.equal(a1.internadosAtivos.length, 1); assert.equal(a1.internadosAtivos[0].tipoPaciente, 'RN'); ok('alta da Mãe mantém RN com nova internação');
  const rn2 = await call('registrarMovimentacaoAtualizarPainel', { idInternacao: a1.internadosAtivos[0].idInternacao, setorAtual: 'ALCON 1', tipoMovimento: 'Evasao', data: hoje(), hora: '17:00' });
  assert.equal(rn2.painel.resumo.ocupados, 0); assert.equal(rn2.painel.resumo.evasoesHoje, 1); ok('evasão do RN libera o leito ALCON');
  assert.match(await falha('registrarMovimentacaoAtualizarPainel', { idInternacao: uenInt, setorAtual: 'UEN', tipoMovimento: 'Evasao', data: hoje(), hora: '17:00' }), /não encontrada/);

  console.log('Qualidade / pele a pele');
  const q = (await call('getPainelOperacionalData', 'UCINCA')).leitos[0].ID_Leito;
  const ua = await call('registrarInternacao', { setor: 'UCINCA', leitoId: q, nome: 'RN Canguru', sexo: 'M', dataNascimento: hoje(), procedencia: 'UTIN 1', data: hoje(), hora: '09:00', pesoNascer: '1500-1799' });
  assert.match(await falha('registrarMovimentacaoAtualizarPainel', { idInternacao: ua.idInternacao, setorAtual: 'UCINCA', tipoMovimento: 'Alta', destino: 'Domiciliar (Capital)', data: hoje(), hora: '20:00' }), /peso/); ok('UCINCA exige peso na alta');
  const pl = await call('buscarIndicadoresPorLeito', q); assert.equal(pl.idInternacao, ua.idInternacao);
  await call('salvarContatoPeleAPele', { idInternacao: ua.idInternacao, dataContato: hoje(), contatoRealizado: 'Sim', duracao: 45 });
  await call('salvarContatoPeleAPele', { idInternacao: ua.idInternacao, dataContato: hoje(), contatoRealizado: 'Sim', duracao: 60 });
  assert.equal((await p.query('SELECT count(*)::int n FROM contato_pele_pele')).rows[0].n, 1); ok('pele a pele: upsert por internação+dia');
  assert.match(await falha('salvarContatoPeleAPele', { idInternacao: ua.idInternacao, dataContato: '2000-01-01', contatoRealizado: 'Sim' }), /anterior/); ok('pele a pele anterior ao nascimento recusado');
  await call('salvarIndicadoresLeito', { idInternacao: ua.idInternacao, data: hoje(), extracaoLeite: 'Sim', visitaMae: 'Sim' });
  await call('salvarIndicadoresLeito', { idInternacao: ua.idInternacao, data: hoje(), extracaoLeite: 'Sim', visitaMae: 'Sim', visitaPai: 'Sim' });
  const d = new Date(), mes = d.getMonth() + 1, ano = d.getFullYear();
  const qual = await call('getDashboardIndicadoresQualidade', `${ano}-${String(mes).padStart(2, '0')}-01`, hoje(), 'TODOS');
  assert.equal(qual.totalRegistros, 1); assert.equal(qual.visitacao.pai.sim, 1); assert.equal(qual.peleAPele1Dia.sim, 1); assert.equal(qual.aleitamentoExclusivoAlta.sim, 1); ok('dashboard de qualidade consolidado');

  console.log('Dashboards e relatórios');
  const est = await call('obterEstatisticasDashboard', 'UTIN 1', mes, ano);
  assert.equal(est.kpis.admissoesMes, 2); assert.equal(est.kpis.altasMes, 1); ok('dashboard UTIN 1: 2 admissões, 1 alta');
  const estUen = await call('obterEstatisticasDashboard', 'UEN', mes, ano); assert.equal(estUen.ehUEN, true); assert.equal(estUen.kpis.admissoesMes, 2); ok('dashboard UEN');
  const geral = await call('obterEstatisticasDashboardGeral', 'Todos os Setores', mes, ano); assert.ok(geral.ehGeral && geral.porSetor.length >= 5); ok('dashboard geral agregado');
  const rel = await call('gerarRelatorioGerencial', { setor: 'Todos os Setores', dataInicial: `${ano}-${String(mes).padStart(2, '0')}-01`, dataFinal: hoje(), indicador: 'Geral' });
  assert.ok(rel.kpis.admissoes >= 5); ok('relatório gerencial (Geral)');
  for (const ind of ['Admissoes', 'Altas', 'Obitos', 'Transferencias', 'Internados']) await call('gerarRelatorioGerencial', { setor: 'UTIN 1', dataInicial: hoje(), dataFinal: hoje(), indicador: ind });
  ok('relatório gerencial (demais indicadores)');
  const nirD = await call('obterDadosNIR'); assert.ok(nirD.find(x => x.setor === 'UTIN 1')); ok('painel NIR');

  console.log('Histórico');
  const busca = await call('buscarPacientesPorNome', 'x', 'maria'); assert.equal(busca.length, 1);
  const hist = await call('obterHistoricoPaciente', 'x', busca[0].idPaciente); assert.equal(hist.internacoes[0].tipoSaida, 'Alta'); assert.ok(hist.internacoes[0].leito); ok('busca e linha do tempo');
  const belo = await call('buscarPacientesPorNome', 'x', "%%"); assert.equal(belo.length, 0); ok('curinga LIKE escapado');

  console.log('Usuários e segurança');
  await call('salvarUsuario', 'x', { nome: 'Novo', perfil: 'SETOR', setor: 'UTIN 1', senha: 'segredo1' }); ok('criar usuário');
  assert.match(await falha('excluirUsuario', 'x', 'NIR Teste'), /própria/); ok('não exclui a própria conta');
  await call('excluirUsuario', 'x', 'Novo'); ok('excluir usuário');
  sess = ENF;
  assert.match(await falha('obterUsuariosAdministrativos', 'x'), /restrito/); assert.match(await falha('gerarRelatorioGerencial', {}), /restrito/); ok('perfil SETOR sem acesso administrativo');
  assert.match(await falha('obterEstatisticasDashboardGeral', 'Todos', 1, 2026), /restrito/); ok('dashboard geral restrito');
  await p.query(`UPDATE sessoes SET expira_em = now() - interval '1 minute'`);
  assert.equal(await validarSessao(loginLegado.token), null); ok('sessão expirada é rejeitada');
  const logs = (await p.query('SELECT count(*)::int n FROM logs')).rows[0].n; assert.ok(logs > 20); ok(`auditoria registrada (${logs} eventos)`);
  console.log(`\nTODOS OS ${n} TESTES PASSARAM`);
  await p.end();
})().catch(e => { console.error('\nFALHOU:', e.stack || e.message); process.exit(1); });
