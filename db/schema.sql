-- Natus — Gestão Inteligente de Leitos (MAB) — schema PostgreSQL
-- Datas/horas são "horário de parede" de Manaus (timestamp sem fuso), como na planilha original.

CREATE TABLE IF NOT EXISTS setores (
  id_setor            text PRIMARY KEY,
  nome_setor          text NOT NULL UNIQUE,
  tipo                text NOT NULL DEFAULT 'Internação',
  capacidade_inicial  integer NOT NULL DEFAULT 0 CHECK (capacidade_inicial >= 0)
);

CREATE TABLE IF NOT EXISTS leitos (
  id_leito           text PRIMARY KEY,
  setor_nome         text NOT NULL REFERENCES setores(nome_setor) ON UPDATE CASCADE ON DELETE RESTRICT,
  numero_leito       text NOT NULL,
  status             text NOT NULL DEFAULT 'Livre' CHECK (status IN ('Livre','Ocupado','Reservado','Reserva','Bloqueado')),
  id_paciente_atual  text,
  exame_externo      text NOT NULL DEFAULT 'Não',
  id_paciente_mae    text,   -- ALCON: vínculo da Mãe
  id_paciente_rn     text    -- ALCON: vínculo do RN
);
CREATE INDEX IF NOT EXISTS ix_leitos_setor ON leitos(setor_nome);

CREATE TABLE IF NOT EXISTS pacientes (
  id_paciente        text PRIMARY KEY,
  nome               text NOT NULL,
  data_nascimento    date,
  sexo               char(1),
  numero_prontuario  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_pacientes_nome ON pacientes (upper(nome) text_pattern_ops);

CREATE TABLE IF NOT EXISTS internacoes (
  id_internacao            text PRIMARY KEY,
  id_paciente              text NOT NULL REFERENCES pacientes(id_paciente) ON DELETE RESTRICT,
  id_leito                 text,            -- referência "frouxa": leitos da UEN são extintos na saída
  numero_leito             text NOT NULL DEFAULT '',  -- cópia do número do leito, preserva o histórico
  setor_nome               text NOT NULL REFERENCES setores(nome_setor) ON UPDATE CASCADE ON DELETE RESTRICT,
  data_hora_entrada        timestamp NOT NULL,
  procedencia              text NOT NULL DEFAULT '',
  tipo_parto               text NOT NULL DEFAULT '',
  peso_nascer              text NOT NULL DEFAULT '',
  status                   text NOT NULL DEFAULT 'Ativo',
  hora_nascimento          text NOT NULL DEFAULT '',
  ig                       text NOT NULL DEFAULT '',
  gravidade                text NOT NULL DEFAULT '',
  tipo_paciente            text NOT NULL DEFAULT '',
  observacao_procedimento  text NOT NULL DEFAULT '',
  rn_sozinho               text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_int_setor ON internacoes(setor_nome);
CREATE INDEX IF NOT EXISTS ix_int_paciente ON internacoes(id_paciente);
CREATE INDEX IF NOT EXISTS ix_int_leito_ativo ON internacoes(id_leito) WHERE status = 'Ativo';
CREATE INDEX IF NOT EXISTS ix_int_entrada ON internacoes(data_hora_entrada);

CREATE TABLE IF NOT EXISTS movimentacoes (
  id_movimentacao            text PRIMARY KEY,
  id_internacao              text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE RESTRICT,
  tipo_movimento             text NOT NULL CHECK (tipo_movimento IN ('Alta','Obito','Evasao','Transferencia')),
  data_hora_saida            timestamp NOT NULL,
  destino                    text NOT NULL DEFAULT '',
  observacao                 text NOT NULL DEFAULT '',
  peso_saida_gramas          numeric,
  aleitamento_exclusivo_alta text NOT NULL DEFAULT '',
  etapa_metodo_canguru       text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_mov_int ON movimentacoes(id_internacao);
CREATE INDEX IF NOT EXISTS ix_mov_saida ON movimentacoes(data_hora_saida);

CREATE TABLE IF NOT EXISTS contato_pele_pele (
  id_pele_pele       text PRIMARY KEY,
  id_internacao      text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  id_paciente        text NOT NULL,
  id_leito           text,
  setor_nome         text NOT NULL,
  data_contato       date NOT NULL,
  contato_realizado  text NOT NULL DEFAULT 'Não',
  duracao_min        integer NOT NULL DEFAULT 0,
  dia_vida           text NOT NULL DEFAULT '',
  registrado_por     text NOT NULL DEFAULT '',
  data_hora_registro timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
  UNIQUE (id_internacao, data_contato)
);

CREATE TABLE IF NOT EXISTS indicadores_leito (
  id_indicador               text PRIMARY KEY,
  id_internacao              text NOT NULL REFERENCES internacoes(id_internacao) ON DELETE CASCADE,
  id_paciente                text NOT NULL,
  id_leito                   text,
  setor_nome                 text NOT NULL,
  data                       date NOT NULL,
  extracao_leite_beira_leito text NOT NULL DEFAULT 'Não',
  visita_mae                 text NOT NULL DEFAULT 'Não',
  visita_pai                 text NOT NULL DEFAULT 'Não',
  visita_irmao               text NOT NULL DEFAULT 'Não',
  visita_avos                text NOT NULL DEFAULT 'Não',
  registrado_por             text NOT NULL DEFAULT '',
  data_hora_registro         timestamp NOT NULL DEFAULT (now() AT TIME ZONE 'America/Manaus'),
  UNIQUE (id_internacao, data)
);

CREATE TABLE IF NOT EXISTS usuarios (
  nome        text NOT NULL,
  perfil      text NOT NULL,
  setor       text NOT NULL DEFAULT '',
  senha_hash  text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_nome ON usuarios (lower(nome));

CREATE TABLE IF NOT EXISTS sessoes (
  token       text PRIMARY KEY,
  nome        text NOT NULL,
  perfil      text NOT NULL,
  setor       text NOT NULL DEFAULT '',
  criado_em   timestamptz NOT NULL DEFAULT now(),
  expira_em   timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_sessoes_expira ON sessoes(expira_em);

CREATE TABLE IF NOT EXISTS logs (
  id        bigserial PRIMARY KEY,
  data_hora timestamptz NOT NULL DEFAULT now(),
  usuario   text NOT NULL DEFAULT 'Sistema',
  acao      text NOT NULL,
  detalhes  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_logs_acao_data ON logs(acao, data_hora);
