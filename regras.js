const { upper } = require('./util');

const PERFIS_ADMINISTRATIVOS = ['NIR', 'SAME', 'NIR/SAME', 'GESTÃO'];
const PERFIS_COM_ACESSO_TIPO_NIR = ['NIR', 'GESTÃO'];
const SETORES_INTERNOS = ['CCO', 'PPP', 'UCINCA', 'UCINCO', 'UTIN 1', 'UTIN 2', 'UTIN 3', 'ALCON 1', 'ALCON 2', 'UTI MATERNA', 'CUIDADOS ESPECIAIS', 'ABRIGO', 'UEN'];
const SETOR_UEN = 'UEN';
const ROTULO_SETOR_UEN = 'Leito Extra CCO Neonatal';
const SETORES_ALCON = ['ALCON 1', 'ALCON 2'];
const SETORES_PADRAO = ['UTIN 1', 'UTIN 2', 'UTIN 3', 'UCINCO', 'UCINCA', 'ALCON 1', 'ALCON 2', 'UTI MATERNA'];

const ehPerfilNIR = p => PERFIS_COM_ACESSO_TIPO_NIR.includes(upper(p));
const ehPerfilAdministrativo = p => PERFIS_ADMINISTRATIVOS.includes(upper(p));
const ehSetorAlcon = s => SETORES_ALCON.includes(upper(s));
const ehMae = t => ['MAE', 'MÃE'].includes(upper(t));
const classificarMovimentoInterno = v => { const x = upper(v); return SETORES_INTERNOS.some(s => x === s || x.indexOf(s + ' -') === 0); };
const classificarProcedenciaInterna = v => SETORES_INTERNOS.includes(upper(v));

module.exports = { PERFIS_ADMINISTRATIVOS, SETORES_INTERNOS, SETOR_UEN, ROTULO_SETOR_UEN, SETORES_ALCON, SETORES_PADRAO,
  ehPerfilNIR, ehPerfilAdministrativo, ehSetorAlcon, ehMae, classificarMovimentoInterno, classificarProcedenciaInterna };
