# Idealize CRM Intelligence

CRM das Óticas Idealize: lead do anúncio da Meta → atendimento → agendamento → venda no ADM/PDV, com atribuição por campanha, anúncio, criativo, vendedor e unidade.

## Rodar localmente
```bash
npm install
cp .env.example .env.local      # preencha o que tiver; vazio funciona em modo local
npm run db:migrate              # cria o banco local (./.data) + etapas, regras e unidades
npm run db:seed                 # OPCIONAL: usuários e leads FICTÍCIOS de teste
npm run build && npm start      # http://localhost:3000
npm test                        # 24 testes automatizados
```
Usuários de teste (só após o seed): `diretoria.teste`, `gestor.<unidade>`, `vendedor1.<unidade>` — senha `teste-local-123`.
Unidades: `sao-vicente`, `campinas`, `sorocaba`, `piracicaba`.

## Estrutura
```
src/app/(app)/        telas (dashboard, pipeline, leads, campanhas, vendas, automações, integrações, configurações)
src/app/api/          webhooks Meta, entrada de vendas, jobs, logout
src/app/actions.ts    ações das telas (todas checam permissão)
src/server/           regras: crm, ingest (fila), meta, sales, capi, metrics, scope (acesso), auth
src/db/schema.ts      modelo de dados  ·  drizzle/  migrações SQL
tests/                testes automatizados
```

## Integrações
### Webhook Meta — `GET|POST /api/webhooks/meta`
No app Meta: URL de callback = `https://SEU-DOMINIO/api/webhooks/meta`, token de verificação = `META_WEBHOOK_VERIFY_TOKEN`. Assinar o campo **messages** (WhatsApp Business Account) e **leadgen** (Página). Toda chamada sem assinatura válida recebe 401.

Depois, em **Integrações → Roteamento**, cadastrar o `phone_number_id` de cada loja → unidade.

### Vendas ADM / PDV — `POST /api/integrations/sales`
Header `X-Integration-Key: <SALES_INGEST_KEY>`. Corpo (uma venda ou `{ "sales": [...] }`, até 500):
```json
{ "source": "pdv", "externalId": "OS-12345", "customerName": "Maria", "cpf": "000.000.000-00",
  "phone": "(13) 99999-9999", "amount": 899.90, "soldAt": "2026-10-30T15:20:00-03:00",
  "unitSlug": "sao-vicente", "sellerName": "Mariana", "products": [{ "name": "Multifocal 70%", "qty": 1, "amount": 899.90 }] }
```
Reenviar a mesma venda (mesmo `source` + `externalId`) não duplica. O CPF é guardado só como hash.

### Jobs — `GET /api/jobs` com `Authorization: Bearer <CRON_SECRET>`
Processa a fila (retentativas) e a varredura de inatividade. Agendar a cada 1 minuto.

## Segurança
Tokens só no servidor (variáveis de ambiente), nunca no navegador. Senhas com bcrypt. Sessões no banco com expiração de 12h. Acesso a leads sempre filtrado por unidade/dono (`src/server/scope.ts`). Auditoria em `audit_log`.
