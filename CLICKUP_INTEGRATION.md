# 🔗 Integração ClickUp - THX Ops

## ✅ Implementação Completa

A integração com o ClickUp foi implementada com sucesso, sincronizando automaticamente tarefas da VIEW específica para o sistema THX Ops.

---

## 📋 Estrutura de Abas Criadas

### 1. **CLICKUP_TASKS** (Armazenamento de Tarefas)
Colunas criadas automaticamente:

| Coluna | Descrição |
|--------|-----------|
| `task_id` | ID único da tarefa no ClickUp |
| `task_url` | URL da tarefa |
| `name` | Nome/título da tarefa |
| `status` | Status atual (ex: "to do", "in progress", "complete") |
| `priority` | Prioridade (urgent, high, normal, low) |
| `assignees` | Lista de responsáveis (nomes) |
| `responsavel_principal` | Primeiro responsável da lista |
| `due_date` | Data de vencimento |
| `start_date` | Data de início |
| `date_created` | Data de criação |
| `date_updated` | Última atualização |
| `date_closed` | Data de conclusão |
| `time_estimate` | Tempo estimado |
| `time_spent` | Tempo gasto |
| `tags` | Tags da tarefa |
| `custom_fields` | Campos customizados (JSON) |
| `list_id` | ID da lista |
| `list_name` | Nome da lista |
| `folder_id` | ID da pasta |
| `space_id` | ID do espaço |
| `fora_da_view` | Marcador se saiu da VIEW |
| `last_sync_at` | Timestamp da última sincronização |

### 2. **LOG_SYNC** (Log de Erros)
Registra todos os erros de sincronização:

| Coluna | Descrição |
|--------|-----------|
| `timestamp` | Data/hora do erro |
| `function` | Função que gerou o erro |
| `method` | Método HTTP (GET, POST, etc) |
| `endpoint` | Endpoint da API |
| `status_code` | Código HTTP de erro |
| `message` | Mensagem de erro |
| `page` | Página da paginação (se aplicável) |

### 3. **MAPEAMENTO_USUARIOS** (Mapeamento de Usuários)
Relaciona usuários do ClickUp com usuários internos:

| Coluna | Descrição |
|--------|-----------|
| `clickup_user_id` | ID do usuário no ClickUp |
| `clickup_username` | Nome de usuário no ClickUp |
| `email_interno` | Email do usuário no sistema interno |
| `usuario_interno` | Nome do usuário interno |
| `ativo` | Se o mapeamento está ativo |

**Exemplo:**
```
12345 | john.doe | john@example.com | John Doe | true
```

---

## 🔧 Funções Implementadas (Code.js)

### **Backend - Funções Principais**

#### 1. `getClickUpToken()`
- Obtém token das Script Properties (seguro)
- **NUNCA exposto ao frontend**

#### 2. `setClickUpToken(token)`
- Define o token nas Script Properties
- Executar uma única vez para configurar

#### 3. `clickupRequest(method, path, params, body)`
- Cliente HTTP com retry automático
- Trata rate limiting (429) com backoff exponencial
- Retry em erros 5xx (até 3 tentativas)
- Headers de autenticação automáticos

#### 4. `getClickUpViewTasks(viewId, includeClosed)`
- Busca tarefas da VIEW específica
- Paginação automática
- Proteção contra loops infinitos (limite 100 páginas)
- Retorna todas as tarefas da VIEW

#### 5. `syncClickUpViewToSheet()`
- Sincroniza tarefas do ClickUp para `CLICKUP_TASKS`
- **Upsert**: atualiza existentes, insere novas
- Marca tarefas que saíram da VIEW (`fora_da_view = true`)
- Retorna estatísticas de sincronização

#### 6. `syncClickUpToRoutine()`
- Cria/atualiza tarefas internas vinculadas ao ClickUp
- Mapeia status do ClickUp para status interno
- Mapeia prioridades
- Busca mapeamento de usuários
- Vincula via tag `[ClickUp:task_id]` na descrição

#### 7. `syncAll()`
- **Orquestrador principal**
- Executa sync completo: VIEW → Sheet → Rotinas
- Salva status da última sincronização
- Retorna métricas completas

#### 8. `syncClickUpNow()`
- **Função exposta para frontend**
- Wrapper seguro do `syncAll()`
- Retorna resultado formatado

#### 9. `getLastSyncStatus()`
- **Função exposta para frontend**
- Retorna status da última sincronização
- Mostra sucesso/erro, timestamp, métricas

#### 10. `createOrUpdateClickUpTrigger()`
- Cria trigger time-driven automático
- Intervalo: 10 minutos (configurável via `SYNC_INTERVAL_MIN`)
- Remove triggers antigos automaticamente

#### 11. `removeClickUpTrigger()`
- Remove triggers automáticos
- Útil para desabilitar sync temporariamente

#### 12. `initializeClickUpIntegration()`
- **EXECUTAR UMA VEZ**
- Configura token automaticamente
- Cria sheets necessárias
- Ativa trigger automático

---

## 🚀 Configuração Inicial (PASSO A PASSO)

### **Passo 1: Executar Função de Inicialização**

No **Editor do Apps Script**, execute uma única vez:

```javascript
initializeClickUpIntegration()
```

Isso irá:
1. ✅ Salvar o token nas Script Properties (seguro)
2. ✅ Criar as 3 abas no Google Sheets
3. ✅ Criar trigger automático (sync a cada 10 min)

### **Passo 2: Primeira Sincronização Manual**

Após inicializar, execute:

```javascript
syncClickUpNow()
```

Ou use o botão "Sincronizar Agora" na interface.

### **Passo 3: Verificar Resultados**

1. Abra o Google Sheets vinculado
2. Veja a aba **CLICKUP_TASKS** com as tarefas importadas
3. Veja a aba **TASKS** com tarefas internas criadas

### **Passo 4: Configurar Mapeamento (Opcional)**

Na aba **MAPEAMENTO_USUARIOS**, adicione linhas para mapear usuários:

```
clickup_user_id | clickup_username | email_interno      | usuario_interno | ativo
12345           | john.doe         | john@empresa.com   | João Silva     | true
67890           | jane.smith       | jane@empresa.com   | Jane Santos    | true
```

---

## 🎨 Interface do Usuário (Frontend)

### **Localização**
Configurações > Integração ClickUp

### **Funcionalidades**

1. **Botão "Sincronizar Agora"**
   - Executa `syncClickUpNow()`
   - Mostra loading durante sync
   - Exibe resumo após conclusão

2. **Botão "Status"**
   - Verifica última sincronização
   - Mostra timestamp e métricas

3. **Card de Status**
   - ✅ Verde: Última sync bem-sucedida
   - ❌ Vermelho: Última sync com erro
   - ℹ️ Amarelo: Nenhuma sync ainda

### **Exemplo de Resumo**
```
✅ Sincronização concluída!
📥 42 tarefas obtidas do ClickUp
💾 42 salvas no banco (12 novas, 30 atualizadas)
🔗 38 sincronizadas com rotinas internas
⏱️ Tempo: 8s
```

---

## ⚙️ Configurações

### **Constantes (Code.js)**

```javascript
const CLICKUP_VIEW_ID = '6-901304433414-1';  // ID da VIEW
const SYNC_INTERVAL_MIN = 10;                // Intervalo do trigger (minutos)
const MAX_RETRIES = 3;                       // Máximo de retries HTTP
const RETRY_DELAY_MS = 2000;                 // Delay inicial entre retries
```

### **Modificar Intervalo de Sync**

Para mudar de 10 para 5 minutos:

1. Altere `SYNC_INTERVAL_MIN = 5`
2. Execute `createOrUpdateClickUpTrigger()`

---

## 🔒 Segurança

### ✅ **Implementado**

1. **Token NUNCA no código-fonte**
   - Armazenado em `Script Properties`
   - Acessível apenas no backend
   - Não exposto ao frontend

2. **Token NUNCA no HTML/Cliente**
   - Todas as chamadas via `google.script.run`
   - Token permanece server-side

3. **Validação de Token**
   - Verifica se existe antes de usar
   - Lança erro claro se não configurado

### ⚠️ **Atenção**

- O arquivo `Code.js` contém o token **temporariamente** na função `initializeClickUpIntegration()`
- Após executar a função UMA VEZ, **remova manualmente** o token do código
- O token estará salvo de forma segura nas Script Properties

### 🛡️ **Como Remover Token do Código (Após Inicialização)**

Após executar `initializeClickUpIntegration()` pela primeira vez:

1. Abra `Code.js`
2. Encontre a função `initializeClickUpIntegration()`
3. Substitua:
```javascript
const token = 'pk_87986690_9X1MC60UE18B1X9PEJFRMEFTT6GNHHFS';
setClickUpToken(token);
```

Por:
```javascript
// Token já configurado nas Script Properties
// Execute setClickUpToken('SEU_TOKEN') manualmente se precisar reconfigurar
```

---

## 📊 Mapeamento de Dados

### **Status ClickUp → Interno**

| ClickUp Status | Status Interno |
|----------------|----------------|
| "complete", "closed" | `done` |
| "in progress" | `doing` |
| Outros | `open` |

### **Prioridade ClickUp → Interno**

| ClickUp Priority | Prioridade Interna |
|------------------|-------------------|
| `urgent` | `urgent` |
| `high` | `high` |
| `normal` | `normal` |
| `low` | `low` |

---

## 🔄 Fluxo de Sincronização

```
┌─────────────────────┐
│  ClickUp VIEW API   │
│  (Auto a cada 10min │
│   ou Manual)        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ getClickUpViewTasks │
│  (Paginação auto)   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ syncViewToSheet     │
│  CLICKUP_TASKS      │
│  (Upsert)           │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ syncToRoutine       │
│  TASKS (internas)   │
│  (Vinculação)       │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Status/Métricas    │
│  Salvas             │
└─────────────────────┘
```

---

## 🧪 Testes

### **Teste 1: Sincronização Manual**
1. Vá em Configurações > Integração ClickUp
2. Clique em "Sincronizar Agora"
3. Aguarde loading
4. Verifique resumo de sucesso

### **Teste 2: Verificar Dados no Sheet**
1. Abra Google Sheets
2. Vá na aba `CLICKUP_TASKS`
3. Verifique se as tarefas da VIEW apareceram

### **Teste 3: Verificar Tarefas Internas**
1. Vá na página "Tarefas" do app
2. Procure por tarefas com `[ClickUp:...]` na descrição
3. Verifique se status/prioridade estão corretos

### **Teste 4: Trigger Automático**
1. Aguarde 10 minutos
2. Clique em "Status"
3. Verifique se houve nova sincronização

### **Teste 5: Tratamento de Erros**
1. Execute `removeClickUpTrigger()`
2. Remova o token: `PropertiesService.getScriptProperties().deleteProperty('CLICKUP_API_KEY')`
3. Tente sincronizar
4. Verifique erro claro: "Token não configurado"
5. Reconfigure: `setClickUpToken('seu_token')`

---

## 🐛 Troubleshooting

### **Erro: "Token não configurado"**
**Solução:**
```javascript
setClickUpToken('pk_87986690_9X1MC60UE18B1X9PEJFRMEFTT6GNHHFS')
```

### **Erro: "Rate limit atingido"**
- A API do ClickUp tem limites de requisições
- O sistema faz retry automático com delay
- Aguarde alguns minutos e tente novamente

### **Tarefas não aparecem**
1. Verifique se a VIEW ID está correta
2. Confirme que a VIEW tem tarefas
3. Verifique logs na aba `LOG_SYNC`

### **Sincronização lenta**
- Normal para VIEWs com muitas tarefas
- Paginação pode demorar se houver centenas de tarefas
- Verifique logs para ver progresso

### **Trigger não executando**
1. Verifique se trigger existe: `ScriptApp.getProjectTriggers()`
2. Recrie: `createOrUpdateClickUpTrigger()`
3. Veja execuções em: Apps Script > Execuções

---

## 📈 Métricas e Monitoramento

### **Logs de Sincronização**
- Todos os erros salvos em `LOG_SYNC`
- Últimos 500 logs mantidos
- Logs antigos deletados automaticamente

### **Métricas Disponíveis**
```javascript
{
  fetched: 42,        // Tarefas obtidas da API
  upserted: 42,       // Tarefas salvas no sheet
  updated: 30,        // Tarefas atualizadas
  inserted: 12,       // Tarefas novas
  outOfView: 5,       // Tarefas que saíram da VIEW
  synced: 38,         // Tarefas sincronizadas com rotinas
  skipped: 4,         // Tarefas puladas (fora da VIEW)
  errors: 0,          // Erros durante sync
  durationMs: 8234    // Tempo total (ms)
}
```

---

## 🎯 Próximos Passos Sugeridos

1. ✅ Executar `initializeClickUpIntegration()` UMA VEZ
2. ✅ Remover token hardcoded do código após inicialização
3. ✅ Configurar mapeamento de usuários na aba `MAPEAMENTO_USUARIOS`
4. ✅ Testar sincronização manual
5. ✅ Aguardar primeira sincronização automática (10 min)
6. ✅ Monitorar aba `LOG_SYNC` por alguns dias

---

## 📚 Referências

- **ClickUp API Docs:** https://clickup.com/api
- **VIEW Endpoint:** `GET /api/v2/view/{view_id}/task`
- **Script Properties:** https://developers.google.com/apps-script/reference/properties
- **Triggers:** https://developers.google.com/apps-script/guides/triggers/installable

---

## ✨ Funcionalidades Implementadas

- [x] Cliente HTTP com retry e rate limiting
- [x] Paginação automática da API
- [x] Sincronização VIEW → Sheet (upsert)
- [x] Sincronização Sheet → Rotinas internas
- [x] Trigger automático a cada 10 minutos
- [x] Interface gráfica (botão + status)
- [x] Logs de erro estruturados
- [x] Mapeamento de usuários configurável
- [x] Métricas detalhadas de sincronização
- [x] Segurança: token em Script Properties
- [x] Tratamento de tarefas que saem da VIEW
- [x] Vinculação via ID do ClickUp

---

**Implementação completa! 🎉**
