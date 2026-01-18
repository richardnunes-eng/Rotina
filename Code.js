// ============================================
// ROUTINE APP - Google Apps Script Backend
// VERSÃO 2.0 - Com Calendar Sync e Recorrência
// ============================================


// ============================================
// ADICIONAR NO INÍCIO DO Code.gs (LINHA 1)
// ============================================

const DEBUG_MODE = true;

function log(message, data) {
  const timestamp = new Date().toISOString();
  const logMsg = `[${timestamp}] ${message}`;
  console.log(logMsg, data || '');
  Logger.log(logMsg + (data ? ': ' + JSON.stringify(data) : ''));
}

function safeExecute(fnName, handler, context) {
  const startTime = new Date();
  context = context || {};
  
  try {
    log(`[${fnName}] INICIANDO`, context);
    const result = handler();
    
    if (result === undefined || result === null) {
      return {
        ok: false,
        error: `Função ${fnName} não retornou valor válido`,
        meta: { fnName, duration: new Date() - startTime, timestamp: new Date().toISOString() }
      };
    }
    
    if (typeof result.ok !== 'boolean') {
      return {
        ok: true,
        data: result,
        meta: { fnName, duration: new Date() - startTime, timestamp: new Date().toISOString() }
      };
    }
    
    const sanitized = sanitizeForJSON(result);
    log(`[${fnName}] SUCESSO`);
    
    return {
      ...sanitized,
      meta: { fnName, duration: new Date() - startTime, timestamp: new Date().toISOString() }
    };
    
  } catch (error) {
    log(`[${fnName}] EXCEÇÃO`, error.toString());
    return {
      ok: false,
      error: error.toString(),
      meta: { fnName, duration: new Date() - startTime, timestamp: new Date().toISOString() }
    };
  }
}

function sanitizeForJSON(obj) {
  try {
    const jsonString = JSON.stringify(obj, (key, value) => {
      if (value instanceof Date) return value.toISOString();
      if (typeof value === 'function') return undefined;
      return value;
    });
    return JSON.parse(jsonString);
  } catch (e) {
    return { ok: false, error: 'Erro ao serializar: ' + e.toString() };
  }
}

function ping() {
  return safeExecute('ping', () => {
    let email = null;
    try {
      email = Session.getActiveUser().getEmail();
    } catch (e) {}
    
    return {
      ok: true,
      data: {
        timestamp: new Date().toISOString(),
        userKey: email || 'anonymous',
        scriptTimeZone: Session.getScriptTimeZone(),
        version: '2.0-FIXED'
      }
    };
  });
}

// Configuração da planilha
const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');

// Obtém ou cria a planilha
function getOrCreateSpreadsheet() {
  let ss;
  
  if (SPREADSHEET_ID) {
    try {
      ss = SpreadsheetApp.openById(SPREADSHEET_ID);
      return ss;
    } catch (e) {
      // ID inválido, criar nova planilha
    }
  }
  
  // Criar nova planilha
  ss = SpreadsheetApp.create('Routine App Database v2');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('Nova planilha criada: ' + ss.getUrl());
  return ss;
}

// Inicializa a estrutura do banco de dados
function initializeDatabase() {
  const ss = getOrCreateSpreadsheet();
  
  const sheets = {
    'USERS': ['userKey', 'email', 'createdAt'],
    'HABITS': ['id', 'userKey', 'name', 'category', 'color', 'icon', 'frequencyJson', 'goalPerDay', 'reminderTime', 'active', 'createdAt', 'updatedAt'],
    'HABIT_LOG': ['id', 'habitId', 'userKey', 'date', 'completed', 'createdAt'],
    'TASKS': ['id', 'userKey', 'title', 'description', 'priority', 'dueDate', 'dueTime', 'status', 'tagsJson', 'calendarEventId', 'calendarUpdatedAt', 'isRecurring', 'recurrenceType', 'recurrenceDays', 'recurrenceTime', 'recurrenceStartDate', 'recurrenceEndDate', 'recurrenceNextRun', 'templateTaskId', 'createdAt', 'updatedAt'],
    'TASK_CHECKLIST': ['id', 'taskId', 'userKey', 'text', 'done', 'createdAt'],
    'GOALS': ['id', 'userKey', 'title', 'metric', 'targetValue', 'currentValue', 'dueDate', 'status', 'createdAt', 'updatedAt'],
    'GOAL_LOG': ['id', 'goalId', 'userKey', 'deltaValue', 'note', 'date', 'createdAt'],
    'JOURNAL': ['id', 'userKey', 'date', 'mood', 'energy', 'note', 'gratitude', 'createdAt', 'updatedAt'],
    'SETTINGS': ['userKey', 'calendarId', 'enableSync', 'defaultEventDurationMin', 'timezone', 'lastSyncAt', 'syncDirection', 'allowImportAll', 'defaultEventHour', 'createdAt', 'updatedAt'],
    'SYNC_LOG': ['id', 'userKey', 'direction', 'entityType', 'entityId', 'calendarEventId', 'status', 'message', 'timestamp']
  };
  
  Object.keys(sheets).forEach(sheetName => {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, sheets[sheetName].length).setValues([sheets[sheetName]]);
      sheet.getRange(1, 1, 1, sheets[sheetName].length).setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
    }
  });
}

// Obtém userKey (email ou fallback)
function getUserKey() {
  try {
    const email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (e) {
    // Sessão anônima
  }
  return 'anonymous_' + Utilities.getUuid();
}

// Helpers de CRUD genéricos
function createRecord(sheetName, data) {
  const ss = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  
  const row = headers.map(header => data[header] !== undefined ? data[header] : '');
  sheet.appendRow(row);
  
  return data;
}

function findRecords(sheetName, filter) {
  const ss = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  
  if (!sheet || sheet.getLastRow() <= 1) {
    return [];
  }
  
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  
  const records = [];
  for (let i = 1; i < data.length; i++) {
    const record = {};
    let matches = true;
    
    for (let j = 0; j < headers.length; j++) {
      record[headers[j]] = data[i][j];
    }
    
    // Aplicar filtros
    for (let key in filter) {
      if (record[key] != filter[key]) {
        matches = false;
        break;
      }
    }
    
    if (matches) {
      record._rowIndex = i + 1;
      records.push(record);
    }
  }
  
  return records;
}

function updateRecord(sheetName, id, updates) {
  const ss = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      for (let key in updates) {
        const colIndex = headers.indexOf(key);
        if (colIndex !== -1) {
          sheet.getRange(i + 1, colIndex + 1).setValue(updates[key]);
        }
      }
      return true;
    }
  }
  return false;
}

function deleteRecord(sheetName, id) {
  const ss = getOrCreateSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idCol = headers.indexOf('id');
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) {
      sheet.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

// ============================================
// CALENDAR SETTINGS
// ============================================

function getCalendarSettings(userKey) {
  try {
    const settings = findRecords('SETTINGS', { userKey: userKey });
    
    if (settings.length > 0) {
      return { ok: true, data: settings[0] };
    } else {
      // Criar configurações padrão
      const defaultSettings = {
        userKey: userKey,
        calendarId: 'primary',
        enableSync: false,
        defaultEventDurationMin: 60,
        timezone: Session.getScriptTimeZone(),
        lastSyncAt: '',
        syncDirection: 'BOTH',
        allowImportAll: false,
        defaultEventHour: '09:00',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      createRecord('SETTINGS', defaultSettings);
      return { ok: true, data: defaultSettings };
    }
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function updateCalendarSettings(userKey, updates) {
  try {
    const settings = findRecords('SETTINGS', { userKey: userKey });
    
    const updateData = {
      ...updates,
      updatedAt: new Date().toISOString()
    };
    
    if (settings.length > 0) {
      // Atualizar usando userKey como identificador
      const ss = getOrCreateSpreadsheet();
      const sheet = ss.getSheetByName('SETTINGS');
      const data = sheet.getDataRange().getValues();
      const headers = data[0];
      const userKeyCol = headers.indexOf('userKey');
      
      for (let i = 1; i < data.length; i++) {
        if (data[i][userKeyCol] === userKey) {
          for (let key in updateData) {
            const colIndex = headers.indexOf(key);
            if (colIndex !== -1) {
              sheet.getRange(i + 1, colIndex + 1).setValue(updateData[key]);
            }
          }
          break;
        }
      }
      
      return { ok: true, data: updateData };
    } else {
      // Criar novo
      const newSettings = {
        userKey: userKey,
        calendarId: updates.calendarId || 'primary',
        enableSync: updates.enableSync || false,
        defaultEventDurationMin: updates.defaultEventDurationMin || 60,
        timezone: updates.timezone || Session.getScriptTimeZone(),
        lastSyncAt: '',
        syncDirection: updates.syncDirection || 'BOTH',
        allowImportAll: updates.allowImportAll || false,
        defaultEventHour: updates.defaultEventHour || '09:00',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      
      createRecord('SETTINGS', newSettings);
      return { ok: true, data: newSettings };
    }
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// CALENDAR SYNC - HELPERS
// ============================================

function logSync(userKey, direction, entityType, entityId, calendarEventId, status, message) {
  try {
    createRecord('SYNC_LOG', {
      id: Utilities.getUuid(),
      userKey: userKey,
      direction: direction,
      entityType: entityType,
      entityId: entityId || '',
      calendarEventId: calendarEventId || '',
      status: status,
      message: message || '',
      timestamp: new Date().toISOString()
    });
  } catch (e) {
    Logger.log('Erro ao registrar log: ' + e.toString());
  }
}

// Converte data/hora para Date object
function parseDateTime(dateStr, timeStr, timezone) {
  if (!dateStr) return null;
  
  try {
    if (timeStr) {
      // Data + hora
      const [hours, minutes] = timeStr.split(':');
      const dateTime = new Date(dateStr + 'T' + timeStr + ':00');
      return dateTime;
    } else {
      // Apenas data
      return new Date(dateStr);
    }
  } catch (e) {
    Logger.log('Erro ao parsear data/hora: ' + e.toString());
    return null;
  }
}

// ============================================
// CALENDAR SYNC - EXPORT
// ============================================

function exportTaskToCalendar(userKey, taskId) {
  try {
    const settingsResult = getCalendarSettings(userKey);
    if (!settingsResult.ok) {
      return { ok: false, error: 'Erro ao obter configurações' };
    }
    
    const settings = settingsResult.data;
    if (!settings.enableSync) {
      return { ok: false, error: 'Sincronização não está habilitada' };
    }
    
    const tasks = findRecords('TASKS', { id: taskId, userKey: userKey });
    if (tasks.length === 0) {
      return { ok: false, error: 'Tarefa não encontrada' };
    }
    
    const task = tasks[0];
    const calendar = CalendarApp.getCalendarById(settings.calendarId);
    
    if (!calendar) {
      return { ok: false, error: 'Calendário não encontrado' };
    }
    
    // Preparar dados do evento
    const eventTitle = '[Tarefa] ' + task.title;
    let eventDescription = 'ID: ' + task.id + '\n';
    eventDescription += 'Prioridade: ' + (task.priority || 'normal') + '\n';
    if (task.description) {
      eventDescription += '\n' + task.description;
    }
    eventDescription += '\n\n[ROUTINE_APP_SYNC]';
    
    let event;
    
    // Determinar se é all-day ou com horário
    if (task.dueTime) {
      // Evento com horário
      const startDate = parseDateTime(task.dueDate, task.dueTime, settings.timezone);
      const endDate = new Date(startDate.getTime() + settings.defaultEventDurationMin * 60000);
      
      if (task.calendarEventId) {
        // Atualizar evento existente
        try {
          event = calendar.getEventById(task.calendarEventId);
          if (event) {
            event.setTitle(eventTitle);
            event.setDescription(eventDescription);
            event.setTime(startDate, endDate);
          } else {
            // Evento não encontrado, criar novo
            event = calendar.createEvent(eventTitle, startDate, endDate, { description: eventDescription });
          }
        } catch (e) {
          // Criar novo se houver erro
          event = calendar.createEvent(eventTitle, startDate, endDate, { description: eventDescription });
        }
      } else {
        // Criar novo evento
        event = calendar.createEvent(eventTitle, startDate, endDate, { description: eventDescription });
      }
    } else if (task.dueDate) {
      // Evento all-day
      const date = new Date(task.dueDate);
      
      if (task.calendarEventId) {
        // Atualizar evento existente
        try {
          event = calendar.getEventById(task.calendarEventId);
          if (event) {
            event.setTitle(eventTitle);
            event.setDescription(eventDescription);
            event.setAllDayDate(date);
          } else {
            event = calendar.createAllDayEvent(eventTitle, date, { description: eventDescription });
          }
        } catch (e) {
          event = calendar.createAllDayEvent(eventTitle, date, { description: eventDescription });
        }
      } else {
        event = calendar.createAllDayEvent(eventTitle, date, { description: eventDescription });
      }
    } else {
      return { ok: false, error: 'Tarefa sem data definida' };
    }
    
    // Atualizar tarefa com eventId
    updateRecord('TASKS', taskId, {
      calendarEventId: event.getId(),
      calendarUpdatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    
    logSync(userKey, 'EXPORT', 'TASK', taskId, event.getId(), 'SUCCESS', 'Tarefa exportada');
    
    return { ok: true, data: { eventId: event.getId(), eventLink: event.getHtmlLink() } };
    
  } catch (error) {
    logSync(userKey, 'EXPORT', 'TASK', taskId, '', 'ERROR', error.toString());
    return { ok: false, error: error.toString() };
  }
}

function unlinkTaskFromCalendar(userKey, taskId) {
  try {
    const tasks = findRecords('TASKS', { id: taskId, userKey: userKey });
    if (tasks.length === 0) {
      return { ok: false, error: 'Tarefa não encontrada' };
    }
    
    updateRecord('TASKS', taskId, {
      calendarEventId: '',
      calendarUpdatedAt: '',
      updatedAt: new Date().toISOString()
    });
    
    logSync(userKey, 'UNLINK', 'TASK', taskId, '', 'SUCCESS', 'Tarefa desvinculada');
    
    return { ok: true, data: { id: taskId } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// CALENDAR SYNC - IMPORT
// ============================================

function importCalendarEvents(userKey, options) {
  try {
    const settingsResult = getCalendarSettings(userKey);
    if (!settingsResult.ok) {
      return { ok: false, error: 'Erro ao obter configurações' };
    }
    
    const settings = settingsResult.data;
    if (!settings.enableSync) {
      return { ok: false, error: 'Sincronização não está habilitada' };
    }
    
    const calendar = CalendarApp.getCalendarById(settings.calendarId);
    if (!calendar) {
      return { ok: false, error: 'Calendário não encontrado' };
    }
    
    const rangeDaysPast = options.rangeDaysPast || 7;
    const rangeDaysFuture = options.rangeDaysFuture || 30;
    
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - rangeDaysPast);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + rangeDaysFuture);
    
    const events = calendar.getEvents(startDate, endDate);
    
    let imported = 0;
    let updated = 0;
    let skipped = 0;
    
    events.forEach(event => {
      try {
        const description = event.getDescription() || '';
        const hasMarker = description.includes('[ROUTINE_APP_SYNC]');
        
        // Verificar se deve importar
        if (!hasMarker && !settings.allowImportAll) {
          skipped++;
          return;
        }
        
        // Verificar se já existe tarefa vinculada
        const existingTasks = findRecords('TASKS', { calendarEventId: event.getId(), userKey: userKey });
        
        let title = event.getTitle();
        // Remover prefixo se existir
        title = title.replace('[Tarefa] ', '');
        
        const startTime = event.getStartTime();
        const allDay = event.isAllDayEvent();
        
        const taskData = {
          title: title,
          description: event.getDescription().replace('[ROUTINE_APP_SYNC]', '').trim(),
          dueDate: Utilities.formatDate(startTime, settings.timezone, 'yyyy-MM-dd'),
          dueTime: allDay ? '' : Utilities.formatDate(startTime, settings.timezone, 'HH:mm'),
          calendarEventId: event.getId(),
          calendarUpdatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };
        
        if (existingTasks.length > 0) {
          // Atualizar tarefa existente
          updateRecord('TASKS', existingTasks[0].id, taskData);
          updated++;
          logSync(userKey, 'IMPORT', 'TASK', existingTasks[0].id, event.getId(), 'SUCCESS', 'Tarefa atualizada');
        } else {
          // Criar nova tarefa
          const newTask = {
            id: Utilities.getUuid(),
            userKey: userKey,
            ...taskData,
            priority: 'normal',
            status: 'open',
            tagsJson: '[]',
            isRecurring: false,
            recurrenceType: '',
            recurrenceDays: '',
            recurrenceTime: '',
            recurrenceStartDate: '',
            recurrenceEndDate: '',
            recurrenceNextRun: '',
            templateTaskId: '',
            createdAt: new Date().toISOString()
          };
          
          createRecord('TASKS', newTask);
          imported++;
          logSync(userKey, 'IMPORT', 'TASK', newTask.id, event.getId(), 'SUCCESS', 'Nova tarefa criada');
        }
      } catch (e) {
        Logger.log('Erro ao importar evento: ' + e.toString());
        logSync(userKey, 'IMPORT', 'EVENT', '', event.getId(), 'ERROR', e.toString());
      }
    });
    
    return { 
      ok: true, 
      data: { 
        imported: imported, 
        updated: updated, 
        skipped: skipped,
        total: events.length
      } 
    };
    
  } catch (error) {
    logSync(userKey, 'IMPORT', '', '', '', 'ERROR', error.toString());
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// CALENDAR SYNC - BIDIRECTIONAL
// ============================================

function syncCalendar(userKey, options) {
  try {
    const mode = options.mode || 'BOTH';
    const rangeDaysPast = options.rangeDaysPast || 7;
    const rangeDaysFuture = options.rangeDaysFuture || 30;
    
    let exportResult, importResult;
    
    if (mode === 'EXPORT_ONLY' || mode === 'BOTH') {
      // Exportar tarefas vinculadas
      const tasks = findRecords('TASKS', { userKey: userKey });
      let exported = 0;
      
      tasks.forEach(task => {
        if (task.dueDate && (task.calendarEventId || task.status !== 'completed')) {
          const result = exportTaskToCalendar(userKey, task.id);
          if (result.ok) exported++;
        }
      });
      
      exportResult = { exported: exported };
    }
    
    if (mode === 'IMPORT_ONLY' || mode === 'BOTH') {
      importResult = importCalendarEvents(userKey, { rangeDaysPast, rangeDaysFuture });
    }
    
    // Atualizar lastSyncAt
    updateCalendarSettings(userKey, {
      lastSyncAt: new Date().toISOString()
    });
    
    return {
      ok: true,
      data: {
        export: exportResult,
        import: importResult ? importResult.data : null
      }
    };
    
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// TAREFAS RECORRENTES
// ============================================

function generateRecurringTasks(userKey, options) {
  try {
    const daysAhead = options.daysAhead || 14;
    
    // Buscar tarefas template (recorrentes)
    const allTasks = findRecords('TASKS', { userKey: userKey });
    const templates = allTasks.filter(t => t.isRecurring && t.recurrenceType === 'WEEKLY');
    
    let generated = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    templates.forEach(template => {
      try {
        // Parse recurrence days
        const recurrenceDays = template.recurrenceDays ? JSON.parse(template.recurrenceDays) : [];
        if (recurrenceDays.length === 0) return;
        
        const startDate = template.recurrenceStartDate ? new Date(template.recurrenceStartDate) : today;
        const endDate = template.recurrenceEndDate ? new Date(template.recurrenceEndDate) : new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
        
        // Gerar instâncias para cada dia
        for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
          const dayOfWeek = d.getDay() === 0 ? 7 : d.getDay(); // 1=Seg, 7=Dom
          
          if (recurrenceDays.includes(dayOfWeek)) {
            const dateStr = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
            
            // Verificar se já existe instância para esta data
            const existing = allTasks.filter(t => 
              t.templateTaskId === template.id && 
              t.dueDate === dateStr
            );
            
            if (existing.length === 0) {
              // Criar nova instância
              const instance = {
                id: Utilities.getUuid(),
                userKey: userKey,
                title: template.title,
                description: template.description,
                priority: template.priority,
                dueDate: dateStr,
                dueTime: template.recurrenceTime || '',
                status: 'open',
                tagsJson: template.tagsJson,
                calendarEventId: '',
                calendarUpdatedAt: '',
                isRecurring: false, // Instância não é recorrente
                recurrenceType: '',
                recurrenceDays: '',
                recurrenceTime: '',
                recurrenceStartDate: '',
                recurrenceEndDate: '',
                recurrenceNextRun: '',
                templateTaskId: template.id, // Referência ao template
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
              };
              
              createRecord('TASKS', instance);
              generated++;
            }
          }
        }
      } catch (e) {
        Logger.log('Erro ao gerar recorrências para template ' + template.id + ': ' + e.toString());
      }
    });
    
    return { ok: true, data: { generated: generated } };
    
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// ENDPOINTS DA API
// ============================================

function doGet() {
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('Routine App v2')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// Inicializa o app e retorna todos os dados do usuário
function initApp(providedUserKey) {
  
  return safeExecute('initApp', () => {
    log('=== INIT APP COMEÇANDO ===');
    const userKey = providedUserKey || getUserKey();
    
    // Criar usuário se não existir
    const existingUser = findRecords('USERS', { userKey: userKey });
    if (existingUser.length === 0) {
      createRecord('USERS', {
        userKey: userKey,
        email: userKey.includes('@') ? userKey : '',
        createdAt: new Date().toISOString()
      });
    }
    
    // Gerar tarefas recorrentes (silenciosamente, sem bloquear)
    try {
      generateRecurringTasks(userKey, { daysAhead: 14 });
    } catch (e) {
      Logger.log('Erro ao gerar recorrências: ' + e.toString());
    }
    
    // Buscar todos os dados do usuário
    const habits = findRecords('HABITS', { userKey: userKey });
    const habitLogs = findRecords('HABIT_LOG', { userKey: userKey });
    const tasks = findRecords('TASKS', { userKey: userKey });
    const taskChecklists = findRecords('TASK_CHECKLIST', { userKey: userKey });
    const goals = findRecords('GOALS', { userKey: userKey });
    const goalLogs = findRecords('GOAL_LOG', { userKey: userKey });
    const journals = findRecords('JOURNAL', { userKey: userKey });
    const settingsResult = getCalendarSettings(userKey);
    const settings = settingsResult.ok ? settingsResult.data : null;
    
    return {
      ok: true,
      data: {
        userKey: userKey,
        habits: habits,
        habitLogs: habitLogs,
        tasks: tasks,
        taskChecklists: taskChecklists,
        goals: goals,
        goalLogs: goalLogs,
        journals: journals,
        settings: settings
      }
    };
const response = {
      ok: true,
      data: {
        userKey: userKey,
        habits: habits || [],
        habitLogs: habitLogs || [],
        tasks: tasks || [],
        taskChecklists: taskChecklists || [],
        goals: goals || [],
        goalLogs: goalLogs || [],
        journals: journals || [],
        settings: settings
      }
    };
    
    log('=== INIT APP CONCLUÍDO ===');
    return response;
    
  }, { userKey: providedUserKey });
}

// ============================================
// HABITS (mantém implementação original)
// ============================================

function createHabit(userKey, habitData) {
  try {
    const habit = {
      id: Utilities.getUuid(),
      userKey: userKey,
      name: habitData.name || '',
      category: habitData.category || 'other',
      color: habitData.color || '#4285f4',
      icon: habitData.icon || 'check_circle',
      frequencyJson: JSON.stringify(habitData.frequency || { type: 'daily' }),
      goalPerDay: habitData.goalPerDay || 1,
      reminderTime: habitData.reminderTime || '',
      active: habitData.active !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    createRecord('HABITS', habit);
    return { ok: true, data: habit };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function updateHabit(userKey, habitId, updates) {
  try {
    const habits = findRecords('HABITS', { id: habitId, userKey: userKey });
    if (habits.length === 0) {
      return { ok: false, error: 'Habit not found' };
    }
    
    const updateData = {
      updatedAt: new Date().toISOString()
    };
    
    if (updates.name) updateData.name = updates.name;
    if (updates.category) updateData.category = updates.category;
    if (updates.color) updateData.color = updates.color;
    if (updates.icon) updateData.icon = updates.icon;
    if (updates.frequency) updateData.frequencyJson = JSON.stringify(updates.frequency);
    if (updates.goalPerDay) updateData.goalPerDay = updates.goalPerDay;
    if (updates.reminderTime !== undefined) updateData.reminderTime = updates.reminderTime;
    if (updates.active !== undefined) updateData.active = updates.active;
    
    updateRecord('HABITS', habitId, updateData);
    return { ok: true, data: { id: habitId, ...updateData } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function deleteHabit(userKey, habitId) {
  try {
    const habits = findRecords('HABITS', { id: habitId, userKey: userKey });
    if (habits.length === 0) {
      return { ok: false, error: 'Habit not found' };
    }
    
    deleteRecord('HABITS', habitId);
    
    const logs = findRecords('HABIT_LOG', { habitId: habitId, userKey: userKey });
    logs.forEach(log => deleteRecord('HABIT_LOG', log.id));
    
    return { ok: true, data: { id: habitId } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function toggleHabitCompletion(userKey, habitId, date) {
  try {
    const habits = findRecords('HABITS', { id: habitId, userKey: userKey });
    if (habits.length === 0) {
      return { ok: false, error: 'Habit not found' };
    }
    
    const logs = findRecords('HABIT_LOG', { habitId: habitId, userKey: userKey, date: date });
    
    if (logs.length > 0) {
      const newStatus = !logs[0].completed;
      updateRecord('HABIT_LOG', logs[0].id, { completed: newStatus });
      return { ok: true, data: { id: logs[0].id, completed: newStatus } };
    } else {
      const log = {
        id: Utilities.getUuid(),
        habitId: habitId,
        userKey: userKey,
        date: date,
        completed: true,
        createdAt: new Date().toISOString()
      };
      createRecord('HABIT_LOG', log);
      return { ok: true, data: log };
    }
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// TASKS (atualizado com novos campos)
// ============================================

function createTask(userKey, taskData) {
  try {
    const task = {
      id: Utilities.getUuid(),
      userKey: userKey,
      title: taskData.title || '',
      description: taskData.description || '',
      priority: taskData.priority || 'medium',
      dueDate: taskData.dueDate || '',
      dueTime: taskData.dueTime || '',
      status: taskData.status || 'open',
      tagsJson: JSON.stringify(taskData.tags || []),
      calendarEventId: '',
      calendarUpdatedAt: '',
      isRecurring: taskData.isRecurring || false,
      recurrenceType: taskData.recurrenceType || '',
      recurrenceDays: taskData.recurrenceDays ? JSON.stringify(taskData.recurrenceDays) : '',
      recurrenceTime: taskData.recurrenceTime || '',
      recurrenceStartDate: taskData.recurrenceStartDate || '',
      recurrenceEndDate: taskData.recurrenceEndDate || '',
      recurrenceNextRun: '',
      templateTaskId: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    createRecord('TASKS', task);
    
    // Se for recorrente, gerar instâncias
    if (task.isRecurring) {
      generateRecurringTasks(userKey, { daysAhead: 30 });
    }
    
    return { ok: true, data: task };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function updateTask(userKey, taskId, updates) {
  try {
    const tasks = findRecords('TASKS', { id: taskId, userKey: userKey });
    if (tasks.length === 0) {
      return { ok: false, error: 'Task not found' };
    }
    
    const updateData = {
      updatedAt: new Date().toISOString()
    };
    
    if (updates.title) updateData.title = updates.title;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.priority) updateData.priority = updates.priority;
    if (updates.dueDate !== undefined) updateData.dueDate = updates.dueDate;
    if (updates.dueTime !== undefined) updateData.dueTime = updates.dueTime;
    if (updates.status) updateData.status = updates.status;
    if (updates.tags) updateData.tagsJson = JSON.stringify(updates.tags);
    if (updates.isRecurring !== undefined) updateData.isRecurring = updates.isRecurring;
    if (updates.recurrenceType) updateData.recurrenceType = updates.recurrenceType;
    if (updates.recurrenceDays) updateData.recurrenceDays = JSON.stringify(updates.recurrenceDays);
    if (updates.recurrenceTime !== undefined) updateData.recurrenceTime = updates.recurrenceTime;
    if (updates.recurrenceStartDate !== undefined) updateData.recurrenceStartDate = updates.recurrenceStartDate;
    if (updates.recurrenceEndDate !== undefined) updateData.recurrenceEndDate = updates.recurrenceEndDate;
    
    updateRecord('TASKS', taskId, updateData);
    
    // Se alterou recorrência, regerar instâncias
    if (updates.isRecurring || updates.recurrenceDays || updates.recurrenceTime) {
      generateRecurringTasks(userKey, { daysAhead: 30 });
    }
    
    return { ok: true, data: { id: taskId, ...updateData } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function deleteTask(userKey, taskId) {
  try {
    const tasks = findRecords('TASKS', { id: taskId, userKey: userKey });
    if (tasks.length === 0) {
      return { ok: false, error: 'Task not found' };
    }
    
    deleteRecord('TASKS', taskId);
    
    const items = findRecords('TASK_CHECKLIST', { taskId: taskId, userKey: userKey });
    items.forEach(item => deleteRecord('TASK_CHECKLIST', item.id));
    
    // Se for template, deletar instâncias
    const instances = findRecords('TASKS', { templateTaskId: taskId, userKey: userKey });
    instances.forEach(inst => deleteRecord('TASKS', inst.id));
    
    return { ok: true, data: { id: taskId } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function setTaskStatus(userKey, taskId, status) {
  try {
    return updateTask(userKey, taskId, { status: status });
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function addChecklistItem(userKey, taskId, text) {
  try {
    const tasks = findRecords('TASKS', { id: taskId, userKey: userKey });
    if (tasks.length === 0) {
      return { ok: false, error: 'Task not found' };
    }
    
    const item = {
      id: Utilities.getUuid(),
      taskId: taskId,
      userKey: userKey,
      text: text,
      done: false,
      createdAt: new Date().toISOString()
    };
    
    createRecord('TASK_CHECKLIST', item);
    return { ok: true, data: item };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function toggleChecklistItem(userKey, itemId) {
  try {
    const items = findRecords('TASK_CHECKLIST', { id: itemId, userKey: userKey });
    if (items.length === 0) {
      return { ok: false, error: 'Checklist item not found' };
    }
    
    const newStatus = !items[0].done;
    updateRecord('TASK_CHECKLIST', itemId, { done: newStatus });
    return { ok: true, data: { id: itemId, done: newStatus } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function deleteChecklistItem(userKey, itemId) {
  try {
    const items = findRecords('TASK_CHECKLIST', { id: itemId, userKey: userKey });
    if (items.length === 0) {
      return { ok: false, error: 'Checklist item not found' };
    }
    
    deleteRecord('TASK_CHECKLIST', itemId);
    return { ok: true, data: { id: itemId } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// GOALS (mantém implementação original)
// ============================================

function createGoal(userKey, goalData) {
  try {
    const goal = {
      id: Utilities.getUuid(),
      userKey: userKey,
      title: goalData.title || '',
      metric: goalData.metric || '',
      targetValue: goalData.targetValue || 0,
      currentValue: goalData.currentValue || 0,
      dueDate: goalData.dueDate || '',
      status: goalData.status || 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    createRecord('GOALS', goal);
    return { ok: true, data: goal };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function updateGoal(userKey, goalId, updates) {
  try {
    const goals = findRecords('GOALS', { id: goalId, userKey: userKey });
    if (goals.length === 0) {
      return { ok: false, error: 'Goal not found' };
    }
    
    const updateData = {
      updatedAt: new Date().toISOString()
    };
    
    if (updates.title) updateData.title = updates.title;
    if (updates.metric) updateData.metric = updates.metric;
    if (updates.targetValue !== undefined) updateData.targetValue = updates.targetValue;
    if (updates.currentValue !== undefined) updateData.currentValue = updates.currentValue;
    if (updates.dueDate !== undefined) updateData.dueDate = updates.dueDate;
    if (updates.status) updateData.status = updates.status;
    
    updateRecord('GOALS', goalId, updateData);
    return { ok: true, data: { id: goalId, ...updateData } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function deleteGoal(userKey, goalId) {
  try {
    const goals = findRecords('GOALS', { id: goalId, userKey: userKey });
    if (goals.length === 0) {
      return { ok: false, error: 'Goal not found' };
    }
    
    deleteRecord('GOALS', goalId);
    
    const logs = findRecords('GOAL_LOG', { goalId: goalId, userKey: userKey });
    logs.forEach(log => deleteRecord('GOAL_LOG', log.id));
    
    return { ok: true, data: { id: goalId } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function addGoalProgress(userKey, goalId, delta, note, date) {
  try {
    const goals = findRecords('GOALS', { id: goalId, userKey: userKey });
    if (goals.length === 0) {
      return { ok: false, error: 'Goal not found' };
    }
    
    const currentValue = parseFloat(goals[0].currentValue) + parseFloat(delta);
    updateRecord('GOALS', goalId, { 
      currentValue: currentValue,
      updatedAt: new Date().toISOString()
    });
    
    const log = {
      id: Utilities.getUuid(),
      goalId: goalId,
      userKey: userKey,
      deltaValue: delta,
      note: note || '',
      date: date || new Date().toISOString().split('T')[0],
      createdAt: new Date().toISOString()
    };
    
    createRecord('GOAL_LOG', log);
    return { ok: true, data: { goal: { id: goalId, currentValue: currentValue }, log: log } };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// JOURNAL (mantém implementação original)
// ============================================

function upsertJournalEntry(userKey, date, mood, energy, note, gratitude) {
  try {
    const entries = findRecords('JOURNAL', { userKey: userKey, date: date });
    
    if (entries.length > 0) {
      const updateData = {
        mood: mood,
        energy: energy,
        note: note || '',
        gratitude: gratitude || '',
        updatedAt: new Date().toISOString()
      };
      updateRecord('JOURNAL', entries[0].id, updateData);
      return { ok: true, data: { id: entries[0].id, ...updateData } };
    } else {
      const entry = {
        id: Utilities.getUuid(),
        userKey: userKey,
        date: date,
        mood: mood,
        energy: energy,
        note: note || '',
        gratitude: gratitude || '',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      createRecord('JOURNAL', entry);
      return { ok: true, data: entry };
    }
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

function listJournalEntries(userKey, range) {
  try {
    const entries = findRecords('JOURNAL', { userKey: userKey });
    entries.sort((a, b) => b.date.localeCompare(a.date));
    
    if (range && range.start && range.end) {
      const filtered = entries.filter(e => e.date >= range.start && e.date <= range.end);
      return { ok: true, data: filtered };
    }
    
    return { ok: true, data: entries };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// EXPORT (mantém implementação original)
// ============================================

function exportUserData(userKey, format) {
  try {
    const data = initApp(userKey);
    
    if (!data.ok) {
      return data;
    }
    
    if (format === 'json') {
      const json = JSON.stringify(data.data, null, 2);
      return { ok: true, data: json, contentType: 'application/json', filename: 'routine_app_export.json' };
    } else if (format === 'csv') {
      let csv = '';
      
      Object.keys(data.data).forEach(key => {
        if (Array.isArray(data.data[key]) && data.data[key].length > 0) {
          csv += `\n\n=== ${key.toUpperCase()} ===\n`;
          const headers = Object.keys(data.data[key][0]);
          csv += headers.join(',') + '\n';
          
          data.data[key].forEach(row => {
            const values = headers.map(h => {
              let val = row[h];
              if (typeof val === 'string' && (val.includes(',') || val.includes('"'))) {
                val = '"' + val.replace(/"/g, '""') + '"';
              }
              return val;
            });
            csv += values.join(',') + '\n';
          });
        }
      });
      
      return { ok: true, data: csv, contentType: 'text/csv', filename: 'routine_app_export.csv' };
    }
    
    return { ok: false, error: 'Invalid format' };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}