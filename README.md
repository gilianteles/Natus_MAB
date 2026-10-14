# Natus — Gestão Inteligente de Leitos
Maternidade Ana Braga (MAB) · Manaus-AM · Censo hospitalar, fluxo entre setores, NIR, indicadores e relatórios.

Versão para **Vercel + GitHub + PostgreSQL em nuvem** (portada do projeto Google Apps Script/Planilhas). As telas, regras de
negócio (UEN/vaga zero, binômio ALCON, censo às 24h, mortalidade, Método Canguru etc.) e os endpoints têm os mesmos nomes do original.

## Arquitetura
| Camada | Onde |
|---|---|
| Front-end (6 telas Bootstrap/Chart.js) | `views/*.html` + `public/` (renderizadas por `api/page.js`) |
| API | `api/rpc/[fn].js` (`POST /api/rpc/<função>`, `Authorization: Bearer <token>`) |
| Regras de negócio | `lib/` (`calc.js` indicadores · `operacoes.js` escritas · `painel.js` · `qualidade.js` · `historico.js`) |
| Banco | `db/schema.sql` (PostgreSQL, com chaves estrangeiras, índices e unicidade) |

`public/natus-rpc.js` recria `google.script.run` sobre `fetch`, por isso as telas quase não foram alteradas.

## Interface (design system)
- **Tema claro/escuro** (botão no trilho lateral; segue o sistema operacional até o usuário escolher; preferência salva no navegador).
- Fundo `#F4F5F7`, cards brancos flutuantes (`border-radius: 20px`, borda sutil, sombra leve), tipografia **Plus Jakarta Sans**.
- Trilho lateral compacto com ícones (vira barra inferior no celular), KPIs, gráficos de tendência/distribuição (Chart.js) e cards de leitos por situação.
- Tudo em `public/natus-ui.css` (tokens `--primary`, `--card`, `--bg`…), `public/natus-ui.js` (tema, gráficos, trilho) e `lib/shell.js` (trilho por perfil). Para trocar a paleta, edite só os tokens no início do CSS.

## Implantação (≈10 min)
1. **Banco**: crie um PostgreSQL gratuito (Neon, Supabase ou Vercel Postgres, região São Paulo/`gru1` se disponível) e copie a `DATABASE_URL` (versão *pooled*).
2. **GitHub**: `git init && git add . && git commit -m "Natus" && git remote add origin <repo> && git push -u origin main`.
3. **Vercel**: *Add New > Project* > importe o repositório (framework: *Other*). Em *Environment Variables* defina `DATABASE_URL`. *Deploy*.
4. **Criar tabelas e o 1º usuário** (na sua máquina, apontando para o mesmo banco):
   ```bash
   npm install
   export DATABASE_URL="postgres://..."
   npm run db:migrate
   ADMIN_NOME=admin ADMIN_SENHA='uma-senha-forte' SEED_LEITOS=0 npm run db:seed
   ```
5. Abra `https://<seu-projeto>.vercel.app`, entre como administrador (perfil NIR), cadastre setores/leitos/usuários na tela NIR.
   `GET /api/health` confirma banco e fuso.

### Migrar os dados da planilha
Google Sheets → *Arquivo > Fazer download > .xlsx*, depois:
```bash
npm install            # inclui o leitor de .xlsx (devDependency)
DATABASE_URL=... npm run db:import -- planilha.xlsx --limpar    # --limpar apaga o que já existe
```
Importa Setores, Leitos, Pacientes, Internações, Movimentações, Usuários (senhas antigas continuam válidas e são
convertidas a scrypt no 1º login), Pele a Pele e Indicadores. Roda em transação única (tudo ou nada) e mostra o resumo.

## Desenvolvimento local
`npm run dev` (http://localhost:3000, precisa de `DATABASE_URL`) ou `vercel dev`.
`npm test` executa 45 verificações de ponta a ponta — **apaga os dados do banco apontado**; use um banco de teste.

## Segurança (diferenças em relação ao original)
- Todas as chamadas exigem sessão válida (expira em 12 h, `SESSION_HOURS`); perfis NIR/SAME/GESTÃO e restrição por setor são aplicados **no servidor**, não só na tela.
- Senhas com scrypt + sal (o SHA-256 sem sal da planilha é aceito apenas para migração); bloqueio após 8 falhas/15 min; senha mínima de 6 caracteres.
- O nome do usuário nos logs de auditoria vem da sessão (não do navegador). Erros técnicos não são expostos ao usuário.
- Escritas são transações com trava global (`pg_advisory_xact_lock`), substituindo o `LockService`.
- O token continua na URL (como no original). `Referrer-Policy: same-origin` evita vazamento; para endurecer mais, migrar para cookie HttpOnly.
- Fuso fixo America/Manaus (definido no código; a Vercel não permite a variável `TZ`).

## Observações sobre regras portadas sem alteração
Mantidas como no original; vale revisar com a equipe:
1. **Transferência a partir do ALCON** encerra a internação e libera o vínculo, mas **não cria internação no setor de destino** (o ramo ALCON é executado antes do ramo de transferência interna).
2. **Alta da Mãe no ALCON**: a internação anterior do RN vira "Encerrado - Binômio" sem registro de saída, e uma nova é aberta; no censo de pacientes-dia o RN pode ser contado em duplicidade (a ocupação física do leito não é afetada).
3. `Setores.Leitos_Ativos` é apenas o número inicial de leitos informado na criação do setor.
