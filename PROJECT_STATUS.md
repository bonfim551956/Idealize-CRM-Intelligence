# PROJECT_STATUS — Idealize CRM Intelligence

Atualizado em 30/10/2026 · ambiente: **somente local** (nada foi criado nem alterado nos sistemas da Idealize)

## Decisões tomadas com o Diego
| Tema | Decisão |
|---|---|
| Kommo | O CRM **substitui** a Kommo (pipeline, distribuição, atendimento) |
| Origem principal dos leads | Click-to-WhatsApp (Lead Ads também suportado) |
| Hospedagem | Só local por enquanto; produção depende de "PODE FAZER" |
| Fonte das vendas | Sistema ADM **e** PDV, pela mesma API de entrada |

## Decisões técnicas
- **Next.js 15 + TypeScript + Tailwind** (front e back no mesmo projeto, rotas de API separadas em `src/app/api`, regras em `src/server`).
- **Postgres via Drizzle ORM**. Local: PGlite (Postgres embutido em `./.data`). Produção: qualquer Postgres (Supabase recomendado) via `DATABASE_URL`, mesmas migrações (`drizzle/`).
- **Fila sem Redis**: tabela `webhook_inbox` idempotente (chave única por mensagem/lead/venda), com retentativa exponencial e estado `dead` após 6 falhas. Redis só se o volume justificar.
- **Sessão própria** (usuário + senha, bcrypt, cookie httpOnly, sessão no banco). Funções: diretoria, admin, gestor, vendedor.
- **Isolamento por unidade** centralizado em `src/server/scope.ts`, usado por todas as consultas de lead e pelo dashboard.

## Fases
| Fase | Status |
|---|---|
| 1 Fundação (banco, auth, permissões, multiunidade, interface base) | ✅ concluída (local) |
| 2 CRM (leads, pipeline 12 etapas, histórico, distribuição, automações) | ✅ concluída (local) |
| 3 Meta API | 🟡 código pronto e testado com payloads assinados; **sem conexão real** (faltam credenciais) |
| 4 Rastreamento | ✅ primeiro/último contato, declarada, confirmada/parcial/desconhecida · 🟡 captura de UTM de páginas externas não feita |
| 5 Inteligência | ✅ dashboard, campanhas → anúncios, vendedores, unidades, filtros |
| 6 Conversions API | 🟡 eventos preparados e deduplicados (event_id), **envio bloqueado** até validar o mapeamento |
| 7 Produção | ⛔ aguardando "PODE FAZER" |

## Funcionalidades implementadas
- Webhook Meta (`/api/webhooks/meta`): handshake GET, assinatura `X-Hub-Signature-256` obrigatória, WhatsApp `messages` + Página `leadgen`, enfileira e responde rápido.
- Click-to-WhatsApp: lê `referral.source_id` (ID do anúncio), `ctwa_clid`, `source_url`, `headline`; resolve campanha/conjunto/criativo pelo catálogo sincronizado ou pela Marketing API; sem evidência → atribuição **parcial** (nunca inventa campanha).
- Lead Ads: busca `field_data`, `ad_id`, `adset_id`, `campaign_id`, `form_id` pelo `leadgen_id`.
- Deduplicação: mesma mensagem não processa 2×; mesmo telefone com lead aberto na unidade não abre lead novo (registra mensagem e vira "último contato" se veio de outro anúncio).
- Normalização de telefone BR (inclui wa_id legado sem o 9º dígito).
- Roteamento de unidade por `phone_number_id` do WhatsApp da loja, `page_id` ou `form_id` (tela em Integrações).
- Distribuição: rodízio por unidade, só disponíveis (vendedor liga/desliga), regra por campanha, modo manual; histórico de atribuições; um único dono por lead (troca só por gestor/diretoria).
- Pipeline com as 12 etapas, SLA por etapa (alerta visual), motivo de perda obrigatório, "Venda concluída" só pelo vínculo com ADM/PDV (ou gestor com justificativa).
- Automações configuráveis na tela (ativar/desativar, etapa e minutos): distribuir novo lead, alerta sem atendimento, reatribuição por inatividade (vem desligada), agendamento/confirmação/comparecimento/venda movem etapas.
- Tela do lead: origem completa, conversa recebida, observações, próxima ação, agendamentos com confirmação/comparecimento, troca de responsável, vendas vinculadas.
- Vendas (`/api/integrations/sales`): chave no header, validação, idempotente por origem+ID, CPF só como hash; correspondência por telefone exato (mesma unidade primeiro) → automática; só 8 dígitos ou várias unidades → **revisão manual** na tela Vendas; sem correspondência → fica sem lead.
- Dashboard: leads, atendidos, qualificados, agendamentos, comparecimentos, vendas, faturamento atribuído, 1ª resposta; tabela Campanha | Investimento | Leads | Qualificados | Agendamentos | Vendas | Faturamento | CPL | CPA | ROAS com drill-down por anúncio; por vendedor e por unidade; filtros de período, unidade, vendedor, campanha, origem.
- Dados de teste marcados `is_test` e escondidos por padrão; quando incluídos, faixa de aviso amarela.
- Log de auditoria (login, falhas de login, mudanças de etapa, atribuições, vendas, regras, usuários).

## Testes aprovados (24/24 — `npm test`)
Assinatura do webhook · parsing WhatsApp/leadgen · normalização de telefone · criação de lead com atribuição confirmada · atribuição parcial sem evidência · orgânico = desconhecida · webhook repetido não duplica · first/last touch · rodízio e indisponíveis · falha vai para retentativa · perda exige motivo · venda manual bloqueada para vendedor · automações de agendamento · dono único e bloqueio entre unidades · alerta de inatividade sem repetir · venda vinculada/idempotente/CAPI bloqueado · revisão por 8 dígitos · venda sem lead · cálculo do dashboard por campanha · permissões multiunidade · login/sessão/usuário inativo.

Testes manuais no servidor rodando: handshake (200/403), POST sem assinatura (401), assinado (lead criado e atribuído), repetido (0 enfileirado), venda via HTTP (lead foi para Venda concluída), endpoints sem chave (401), gestor de Campinas abrindo lead de Sorocaba (404), gestor abrindo Integrações (404).

## Erros encontrados e corrigidos
- TypeScript 7 incompatível com Next 15 → fixado TypeScript 6.
- Pasta `memory:` criada nos testes → corrigido o caminho do banco em memória.

## Credenciais e permissões pendentes
1. **App Meta** (tipo Business) com produto WhatsApp + Webhooks; `META_APP_ID`, `META_APP_SECRET`.
2. **Usuário do sistema** no Business Manager com token (`META_SYSTEM_USER_TOKEN`) e permissões, a confirmar no painel do app: `ads_read`, `leads_retrieval`, `pages_show_list`, `pages_manage_metadata`, `whatsapp_business_management`, `whatsapp_business_messaging`.
3. **Os 4 números das lojas na WhatsApp Cloud API.** Hoje estão na Kommo via WhatsApp Lite (QR code): nesse modelo o `referral` do anúncio **não chega** ao CRM. Sem essa migração não há rastreamento Click-to-WhatsApp. Verificar a opção de coexistência (app WhatsApp Business + Cloud API no mesmo número) antes de migrar.
4. `META_DATASET_ID` e validação do mapeamento da Conversions API (`src/server/capi.ts`, `validated: false`).
5. Projeto de produção (Supabase + Vercel) → **precisa de "PODE FAZER"**.
6. ADM e PDV enviarem vendas para `/api/integrations/sales` (ou o CRM ler direto dos bancos deles, somente leitura) → **mexe em sistemas existentes, precisa de "PODE FAZER"**.

## Ainda não feito (próximas tarefas, em ordem)
1. Responder WhatsApp pelo CRM (envio pela Cloud API: janela de 24h e templates aprovados) — é o que efetivamente substitui a Kommo no dia a dia.
2. Script de captura de UTM/fbclid para site e landing pages + link de WhatsApp com código de rastreio.
3. Atualização em tempo real do pipeline (hoje atualiza ao navegar/agir).
4. Rotina LGPD: retenção, anonimização e exportação por titular (campos já existem).
5. 2FA para diretoria/admin; troca de senha pelo próprio usuário.
6. Telas dedicadas de Criativos e Relatórios exportáveis (hoje cobertos por Campanhas → anúncio e Dashboard).

## Observações para produção
- Em Supabase: o app acessa o banco só pelo servidor. Ligar RLS **sem políticas** em todas as tabelas (ou usar um schema não exposto) para nada ficar acessível pela API pública do Supabase.
- Vercel Cron a cada minuto para `/api/jobs` exige plano Pro; alternativa: agendador externo chamando a rota com `CRON_SECRET`.

## Próxima tarefa
Decidir a migração dos números para a WhatsApp Cloud API e, com "PODE FAZER", criar o projeto de produção e o app Meta para o primeiro lead real.
