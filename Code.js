// ============================================
// ROUTINE APP - Google Apps Script Backend
// VERSÃO 2.0 - Com Calendar Sync e Recorrência
// ============================================


// ============================================
// DEBUG & LOGGING
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

// ============================================
// AUTHENTICATION
// ============================================

function ensureAuthSheet() {
  const ss = getOrCreateSpreadsheet();
  let sheet = ss.getSheetByName('AUTH_USERS');
  if (!sheet) {
    sheet = ss.insertSheet('AUTH_USERS');
    sheet.getRange(1, 1, 1, 6).setValues([['name', 'email', 'passwordHash', 'salt', 'createdAt', 'lastLoginAt']]);
    sheet.getRange(1, 1, 1, 6).setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function hashPassword(password, salt) {
  const combined = salt + ':' + password;
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(raw);
}

function findAuthUser(email) {
  const sheet = ensureAuthSheet();
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][1]).toLowerCase() === email.toLowerCase()) {
      return { row: i + 1, email: data[i][1], passwordHash: data[i][2], salt: data[i][3] };
    }
  }
  return null;
}

function registerUser(name, email, password) {
  return safeExecute('registerUser', () => {
    const cleanName = String(name || '').trim();
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    if (!cleanName || !cleanEmail || !cleanPassword) {
      return { ok: false, error: 'Nome, e-mail e senha sao obrigatorios.' };
    }
    if (findAuthUser(cleanEmail)) {
      return { ok: false, error: 'E-mail ja cadastrado.' };
    }
    const salt = Utilities.getUuid();
    const passwordHash = hashPassword(cleanPassword, salt);
    const sheet = ensureAuthSheet();
    sheet.appendRow([cleanName, cleanEmail, passwordHash, salt, new Date().toISOString(), '']);
    return { ok: true, data: { name: cleanName, email: cleanEmail } };
  });
}

function loginUser(email, password) {
  return safeExecute('loginUser', () => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanPassword = String(password || '');
    if (!cleanEmail || !cleanPassword) {
      return { ok: false, error: 'E-mail e senha sao obrigatorios.' };
    }
    const user = findAuthUser(cleanEmail);
    if (!user) {
      return { ok: false, error: 'Usuario ou senha invalidos.' };
    }
    const expectedHash = hashPassword(cleanPassword, user.salt);
    if (expectedHash !== user.passwordHash) {
      return { ok: false, error: 'Usuario ou senha invalidos.' };
    }
    const sheet = ensureAuthSheet();
    sheet.getRange(user.row, 6).setValue(new Date().toISOString());
    return { ok: true, data: { email: cleanEmail } };
  });
}

function ensureResetSheet() {
  const ss = getOrCreateSpreadsheet();
  let sheet = ss.getSheetByName('AUTH_RESETS');
  if (!sheet) {
    sheet = ss.insertSheet('AUTH_RESETS');
    sheet.getRange(1, 1, 1, 5).setValues([['email', 'token', 'expiresAt', 'usedAt', 'createdAt']]);
    sheet.getRange(1, 1, 1, 5).setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function requestPasswordReset(email) {
  return safeExecute('requestPasswordReset', () => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail) {
      return { ok: false, error: 'E-mail obrigatorio.' };
    }
    if (!findAuthUser(cleanEmail)) {
      return { ok: false, error: 'E-mail nao encontrado.' };
    }
    const sheet = ensureResetSheet();
    const token = Utilities.getUuid();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    sheet.appendRow([cleanEmail, token, expiresAt, '', new Date().toISOString()]);
    return { ok: true, data: { token: token } };
  });
}

function resetPassword(email, token, newPassword) {
  return safeExecute('resetPassword', () => {
    const cleanEmail = String(email || '').trim().toLowerCase();
    const cleanToken = String(token || '').trim();
    const cleanPassword = String(newPassword || '');
    if (!cleanEmail || !cleanToken || !cleanPassword) {
      return { ok: false, error: 'Dados invalidos.' };
    }
    const user = findAuthUser(cleanEmail);
    if (!user) {
      return { ok: false, error: 'E-mail nao encontrado.' };
    }

    const sheet = ensureResetSheet();
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    let expiresAt = '';
    let usedAt = '';
    for (let i = data.length - 1; i >= 1; i--) {
      if (String(data[i][0]).toLowerCase() === cleanEmail && String(data[i][1]) === cleanToken) {
        rowIndex = i + 1;
        expiresAt = data[i][2];
        usedAt = data[i][3];
        break;
      }
    }
    if (rowIndex === -1) {
      return { ok: false, error: 'Codigo invalido.' };
    }
    if (usedAt) {
      return { ok: false, error: 'Codigo ja utilizado.' };
    }
    if (expiresAt && new Date(expiresAt) < new Date()) {
      return { ok: false, error: 'Codigo expirado.' };
    }

    const salt = Utilities.getUuid();
    const passwordHash = hashPassword(cleanPassword, salt);
    const authSheet = ensureAuthSheet();
    authSheet.getRange(user.row, 3).setValue(passwordHash);
    authSheet.getRange(user.row, 4).setValue(salt);
    sheet.getRange(rowIndex, 4).setValue(new Date().toISOString());
    return { ok: true, data: { email: cleanEmail } };
  });
}

// ============================================
// DATABASE CONFIGURATION
// ============================================

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');

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
  ss = SpreadsheetApp.create('THX Ops Database');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Logger.log('Nova planilha criada: ' + ss.getUrl());
  return ss;
}

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
    'JOURNAL': ['id', 'userKey', 'date', 'mood', 'energy', 'note', 'gratitude', 'createdAt', 'updatedAt']
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

function getUserKey() {
  try {
    const email = Session.getActiveUser().getEmail();
    if (email) return email;
  } catch (e) {
    // Sessão anônima
  }
  return 'anonymous_' + Utilities.getUuid();
}

// ============================================
// GENERIC CRUD HELPERS
// ============================================

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
// RECURRING TASKS GENERATOR
// ============================================

function generateRecurringTasks(userKey, options) {
  options = options || { daysAhead: 14 };
  const daysAhead = options.daysAhead || 14;
  
  try {
    const templates = findRecords('TASKS', { userKey: userKey, isRecurring: true });
    
    templates.forEach(template => {
      if (!template.recurrenceStartDate) return;
      
      const startDate = new Date(template.recurrenceStartDate);
      const endDate = template.recurrenceEndDate ? new Date(template.recurrenceEndDate) : null;
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + daysAhead);
      
      // Gerar instâncias para os próximos dias
      for (let d = new Date(today); d <= futureDate; d.setDate(d.getDate() + 1)) {
        if (d < startDate) continue;
        if (endDate && d > endDate) break;
        
        const dateStr = d.toISOString().split('T')[0];
        
        // Verificar se já existe instância para este dia
        const existing = findRecords('TASKS', { 
          userKey: userKey, 
          templateTaskId: template.id, 
          dueDate: dateStr 
        });
        
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
            isRecurring: false,
            recurrenceType: '',
            recurrenceDays: '',
            recurrenceTime: '',
            recurrenceStartDate: '',
            recurrenceEndDate: '',
            recurrenceNextRun: '',
            templateTaskId: template.id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };
          
          createRecord('TASKS', instance);
        }
      }
    });
    
    return { ok: true, data: { generated: true } };
  } catch (error) {
    log('Erro ao gerar tarefas recorrentes', error.toString());
    return { ok: false, error: error.toString() };
  }
}

// ============================================
// API ENDPOINTS
// ============================================

function doGet() {
  // Verificar se o usuário está autenticado
  let userEmail = '';

  try {
    userEmail = Session.getActiveUser().getEmail();
  } catch (e) {
    // Falha ao obter email - não autenticado
    log('Erro ao obter email do usuário', e.toString());
  }

  // Se não houver email, significa que não está autenticado
  // Retornar página bootstrap que força login padrão do Google
  if (!userEmail) {
    log('Usuário não autenticado, redirecionando para bootstrap');
    return HtmlService.createTemplateFromFile('bootstrap')
      .evaluate()
      .setTitle('THX Ops - Autenticação')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  }

  // Se autenticado, mostrar o app normal
  log('Usuário autenticado', userEmail);
  return HtmlService.createTemplateFromFile('index')
    .evaluate()
    .setTitle('THX Ops')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function getSessionInfo() {
  try {
    let email = null;

    // Tentar obter email do usuário ativo
    try {
      email = Session.getActiveUser().getEmail();

      // Validar que o email é realmente válido (não vazio)
      if (!email || email.trim() === '') {
        email = null;
      }
    } catch (e) {
      log('Erro ao obter Session.getActiveUser().getEmail()', e.toString());

      // Se falhar, tentar método alternativo
      try {
        email = Session.getEffectiveUser().getEmail();

        if (!email || email.trim() === '') {
          email = null;
        }
      } catch (e2) {
        log('Erro ao obter Session.getEffectiveUser().getEmail()', e2.toString());
        // Ambos os métodos falharam
      }
    }

    const isLoggedIn = !!email;

    log('getSessionInfo resultado', { loggedIn: isLoggedIn, email: email });

    return {
      ok: true,
      loggedIn: isLoggedIn,
      email: email || null
    };
  } catch (error) {
    log('Erro geral em getSessionInfo', error.toString());
    return {
      ok: true,
      loggedIn: false,
      email: null
    };
  }
}

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
        journals: journals || []
      }
    };
    
    log('=== INIT APP CONCLUÍDO ===');
    return response;
  }, { userKey: providedUserKey });
}

// ============================================
// HABITS
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
// TASKS
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
// GOALS
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
// JOURNAL
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
// EXPORT
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

// ============================================
// CLICKUP INTEGRATION
// ============================================

// Constantes de configuração
const CLICKUP_VIEW_ID = '6-901304433414-1';
const SYNC_INTERVAL_MIN = 10;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/**
 * Obtém o token do ClickUp das Script Properties
 * NUNCA retornar token para o frontend - apenas uso interno
 */
function getClickUpToken() {
  const token = PropertiesService.getScriptProperties().getProperty('CLICKUP_API_KEY');
  if (!token) {
    throw new Error('Token do ClickUp não configurado. Configure CLICKUP_API_KEY nas Script Properties.');
  }
  return token;
}

/**
 * Configura o token do ClickUp (executar uma vez apenas)
 * @param {string} token - Token da API do ClickUp
 */
function setClickUpToken(token) {
  if (!token || token.trim() === '') {
    throw new Error('Token inválido');
  }
  PropertiesService.getScriptProperties().setProperty('CLICKUP_API_KEY', token.trim());
  log('Token do ClickUp configurado com sucesso');
  return { ok: true, message: 'Token configurado' };
}

/**
 * EXECUTAR UMA VEZ: Inicializa a integração com ClickUp
 * Define o token e cria as estruturas necessárias
 */
function initializeClickUpIntegration() {
  try {
    // 1. Configurar token
    const token = 'pk_87986690_9X1MC60UE18B1X9PEJFRMEFTT6GNHHFS';
    setClickUpToken(token);

    // 2. Criar sheets necessárias
    ensureClickUpSheets();

    // 3. Criar trigger automático
    createOrUpdateClickUpTrigger();

    log('✅ Integração ClickUp inicializada com sucesso!');

    return {
      ok: true,
      message: 'Integração configurada! Token salvo, sheets criadas e trigger ativado.',
      nextSteps: [
        '1. Execute syncClickUpNow() para fazer a primeira sincronização',
        '2. Verifique a aba CLICKUP_TASKS no Google Sheets',
        '3. Configure mapeamento de usuários na aba MAPEAMENTO_USUARIOS (opcional)'
      ]
    };
  } catch (error) {
    log('❌ Erro ao inicializar integração', error.toString());
    return { ok: false, error: error.toString() };
  }
}

/**
 * Cliente HTTP para ClickUp API com retry e rate limiting
 */
function clickupRequest(method, path, params, body) {
  const baseUrl = 'https://api.clickup.com/api/v2';
  const token = getClickUpToken();

  let url = baseUrl + path;

  // Adicionar query parameters
  if (params && Object.keys(params).length > 0) {
    const queryString = Object.keys(params)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
      .join('&');
    url += '?' + queryString;
  }

  const options = {
    method: method,
    headers: {
      'Authorization': token,
      'Content-Type': 'application/json'
    },
    muteHttpExceptions: true
  };

  if (body) {
    options.payload = JSON.stringify(body);
  }

  // Retry logic com exponential backoff
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      log(`ClickUp ${method} ${path} (tentativa ${attempt}/${MAX_RETRIES})`);

      const response = UrlFetchApp.fetch(url, options);
      const statusCode = response.getResponseCode();
      const responseText = response.getContentText();

      // Success
      if (statusCode >= 200 && statusCode < 300) {
        try {
          const data = JSON.parse(responseText);
          return { ok: true, data: data, statusCode: statusCode };
        } catch (e) {
          return { ok: true, data: responseText, statusCode: statusCode };
        }
      }

      // Rate limit - retry com delay maior
      if (statusCode === 429) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
          log(`Rate limit atingido, aguardando ${delay}ms antes de retry`);
          Utilities.sleep(delay);
          continue;
        }
      }

      // Server errors - retry
      if (statusCode >= 500 && statusCode < 600) {
        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAY_MS * attempt;
          log(`Erro ${statusCode}, aguardando ${delay}ms antes de retry`);
          Utilities.sleep(delay);
          continue;
        }
      }

      // Client errors ou outras respostas - não retry
      let errorMsg = `ClickUp API erro ${statusCode}`;
      try {
        const errorData = JSON.parse(responseText);
        errorMsg = errorData.err || errorData.error || errorMsg;
      } catch (e) {
        errorMsg += ': ' + responseText.substring(0, 200);
      }

      return { ok: false, error: errorMsg, statusCode: statusCode };

    } catch (e) {
      log(`Exceção na requisição ClickUp (tentativa ${attempt}): ${e.toString()}`);
      if (attempt < MAX_RETRIES) {
        Utilities.sleep(RETRY_DELAY_MS * attempt);
        continue;
      }
      return { ok: false, error: e.toString() };
    }
  }

  return { ok: false, error: 'Máximo de tentativas excedido' };
}

/**
 * Busca tarefas da VIEW específica do ClickUp com paginação
 */
function getClickUpViewTasks(viewId, includeClosed) {
  viewId = viewId || CLICKUP_VIEW_ID;
  includeClosed = includeClosed !== undefined ? includeClosed : true;

  const allTasks = [];
  let page = 0;
  let hasMore = true;

  while (hasMore) {
    const params = {
      page: page,
      include_closed: includeClosed,
      subtasks: true
    };

    log(`Buscando página ${page} da view ${viewId}`);
    const result = clickupRequest('GET', `/view/${viewId}/task`, params);

    if (!result.ok) {
      logSyncError('getClickUpViewTasks', 'GET', `/view/${viewId}/task`, result.statusCode, result.error, page);
      return { ok: false, error: result.error, page: page };
    }

    const tasks = result.data.tasks || [];
    allTasks.push(...tasks);

    log(`Página ${page}: ${tasks.length} tarefas recebidas`);

    // Verificar se há mais páginas
    // A API do ClickUp retorna array vazio quando não há mais tarefas
    if (tasks.length === 0) {
      hasMore = false;
    } else {
      page++;
      // Proteção contra loop infinito
      if (page > 100) {
        log('AVISO: Limite de 100 páginas atingido, interrompendo');
        hasMore = false;
      }
    }
  }

  log(`Total de tarefas obtidas: ${allTasks.length}`);
  return { ok: true, tasks: allTasks, totalPages: page };
}

/**
 * Garante que as abas necessárias existam
 */
function ensureClickUpSheets() {
  const ss = getOrCreateSpreadsheet();

  // Aba CLICKUP_TASKS
  const requiredHeaders = [
    'task_id', 'task_url', 'name', 'status', 'priority',
    'assignees', 'responsavel_principal', 'responsavel_email', 'due_date', 'start_date',
    'date_created', 'date_updated', 'date_closed',
    'time_estimate', 'time_spent', 'tags',
    'custom_fields', 'list_id', 'list_name', 'folder_id', 'space_id',
    'fora_da_view', 'last_sync_at'
  ];

  let tasksSheet = ss.getSheetByName('CLICKUP_TASKS');
  if (!tasksSheet) {
    tasksSheet = ss.insertSheet('CLICKUP_TASKS');
  }

  if (tasksSheet.getLastRow() < 1) {
    tasksSheet.getRange(1, 1, 1, requiredHeaders.length).setValues([requiredHeaders]);
    tasksSheet.getRange(1, 1, 1, requiredHeaders.length)
      .setFontWeight('bold')
      .setBackground('#4285f4')
      .setFontColor('#ffffff');
    tasksSheet.setFrozenRows(1);
  } else {
    const headerRow = tasksSheet.getRange(1, 1, 1, tasksSheet.getLastColumn()).getValues()[0];
    const missingHeaders = requiredHeaders.filter(header => headerRow.indexOf(header) === -1);
    if (missingHeaders.length > 0) {
      const startCol = headerRow.length + 1;
      tasksSheet.getRange(1, startCol, 1, missingHeaders.length).setValues([missingHeaders]);
      tasksSheet.getRange(1, startCol, 1, missingHeaders.length)
        .setFontWeight('bold')
        .setBackground('#4285f4')
        .setFontColor('#ffffff');
    }
  }

  // Aba LOG_SYNC
  let logSheet = ss.getSheetByName('LOG_SYNC');
  if (!logSheet) {
    logSheet = ss.insertSheet('LOG_SYNC');
    const headers = ['timestamp', 'function', 'method', 'endpoint', 'status_code', 'message', 'page'];
    logSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    logSheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#ea4335')
      .setFontColor('#ffffff');
    logSheet.setFrozenRows(1);
  }

  // Aba MAPEAMENTO_USUARIOS (opcional)
  let mappingSheet = ss.getSheetByName('MAPEAMENTO_USUARIOS');
  if (!mappingSheet) {
    mappingSheet = ss.insertSheet('MAPEAMENTO_USUARIOS');
    const headers = ['clickup_user_id', 'clickup_username', 'email_interno', 'usuario_interno', 'ativo'];
    mappingSheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    mappingSheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#34a853')
      .setFontColor('#ffffff');
    mappingSheet.setFrozenRows(1);

    // Adicionar linha de exemplo
    mappingSheet.appendRow(['12345', 'john.doe', 'john@example.com', 'John Doe', true]);
  }

  return { tasksSheet, logSheet, mappingSheet };
}

/**
 * Registra erro de sincronização
 */
function logSyncError(functionName, method, endpoint, statusCode, message, page) {
  try {
    const ss = getOrCreateSpreadsheet();
    const logSheet = ss.getSheetByName('LOG_SYNC');
    if (!logSheet) return;

    const row = [
      new Date().toISOString(),
      functionName,
      method,
      endpoint,
      statusCode || '',
      message,
      page !== undefined ? page : ''
    ];

    logSheet.appendRow(row);

    // Manter apenas últimos 500 logs
    if (logSheet.getLastRow() > 501) {
      logSheet.deleteRows(2, logSheet.getLastRow() - 501);
    }
  } catch (e) {
    log('Erro ao registrar log de sync', e.toString());
  }
}

/**
 * Busca mapeamento de usuário ClickUp para interno
 */
function getUserMapping(clickupUserId, clickupUsername) {
  try {
    const ss = getOrCreateSpreadsheet();
    const sheet = ss.getSheetByName('MAPEAMENTO_USUARIOS');
    if (!sheet || sheet.getLastRow() <= 1) return null;

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const mappingUserId = String(row[0]);
      const mappingUsername = String(row[1]);
      const emailInterno = row[2];
      const usuarioInterno = row[3];
      const ativo = row[4];

      if (!ativo) continue;

      if (mappingUserId === String(clickupUserId) || mappingUsername === clickupUsername) {
        return {
          emailInterno: emailInterno,
          usuarioInterno: usuarioInterno
        };
      }
    }
  } catch (e) {
    log('Erro ao buscar mapeamento de usuário', e.toString());
  }
  return null;
}

/**
 * Sincroniza tarefas da VIEW para o Sheet
 */
function syncClickUpViewToSheet() {
  const startTime = new Date();

  try {
    // Garantir que as abas existam
    const sheets = ensureClickUpSheets();
    const tasksSheet = sheets.tasksSheet;

    // Buscar tarefas da VIEW
    log('Iniciando busca de tarefas do ClickUp');
    const result = getClickUpViewTasks(CLICKUP_VIEW_ID, true);

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const tasks = result.tasks;
    const timestamp = new Date().toISOString();

    const headers = tasksSheet.getRange(1, 1, 1, tasksSheet.getLastColumn()).getValues()[0];
    const taskIdIndex = headers.indexOf('task_id');
    if (taskIdIndex === -1) {
      throw new Error('Sheet CLICKUP_TASKS sem coluna task_id.');
    }

    // Obter dados existentes
    let existingData = [];
    const existingById = {};

    if (tasksSheet.getLastRow() > 1) {
      const data = tasksSheet.getDataRange().getValues();

      for (let i = 1; i < data.length; i++) {
        const taskId = String(data[i][taskIdIndex]);
        existingById[taskId] = { rowIndex: i + 1, rowValues: data[i] };
        existingData.push({ rowIndex: i + 1, taskId: taskId });
      }
    }

    // Tarefas vindas da VIEW
    const viewTaskIds = new Set(tasks.map(t => t.id));

    let upserted = 0;
    let updated = 0;
    let inserted = 0;

    // Processar cada tarefa
    for (const task of tasks) {
      const assigneeNames = (task.assignees || []).map(a => a.username || a.email || a.id).join(', ');
      const responsavelPrincipal = task.assignees && task.assignees.length > 0
        ? (task.assignees[0].username || task.assignees[0].email || task.assignees[0].id)
        : '';
      const responsavelEmail = task.assignees && task.assignees.length > 0
        ? (task.assignees[0].email || '')
        : '';

      const tags = (task.tags || []).map(t => t.name).join(', ');
      const customFields = task.custom_fields ? JSON.stringify(task.custom_fields).substring(0, 500) : '';

      const rowRecord = {
        task_id: task.id,
        task_url: task.url || '',
        name: task.name || '',
        status: task.status ? task.status.status : '',
        priority: task.priority ? task.priority.priority : '',
        assignees: assigneeNames,
        responsavel_principal: responsavelPrincipal,
        responsavel_email: responsavelEmail,
        due_date: task.due_date || '',
        start_date: task.start_date || '',
        date_created: task.date_created || '',
        date_updated: task.date_updated || '',
        date_closed: task.date_closed || '',
        time_estimate: task.time_estimate || '',
        time_spent: task.time_spent || '',
        tags: tags,
        custom_fields: customFields,
        list_id: task.list ? task.list.id : '',
        list_name: task.list ? task.list.name : '',
        folder_id: task.folder ? task.folder.id : '',
        space_id: task.space ? task.space.id : '',
        fora_da_view: false,
        last_sync_at: timestamp
      };

      const existing = existingById[task.id];

      if (existing) {
        const rowData = headers.map((header, idx) => (
          Object.prototype.hasOwnProperty.call(rowRecord, header) ? rowRecord[header] : existing.rowValues[idx]
        ));
        // Atualizar linha existente
        tasksSheet.getRange(existing.rowIndex, 1, 1, rowData.length).setValues([rowData]);
        updated++;
      } else {
        const rowData = headers.map(header => (
          Object.prototype.hasOwnProperty.call(rowRecord, header) ? rowRecord[header] : ''
        ));
        // Inserir nova linha
        tasksSheet.appendRow(rowData);
        inserted++;
      }
      upserted++;
    }

    // Marcar tarefas que saíram da VIEW
    let outOfView = 0;
    for (const existing of existingData) {
      if (!viewTaskIds.has(existing.taskId)) {
        // Marcar como fora da view
        const headers = tasksSheet.getRange(1, 1, 1, tasksSheet.getLastColumn()).getValues()[0];
        const foraIndex = headers.indexOf('fora_da_view') + 1;
        const lastSyncIndex = headers.indexOf('last_sync_at') + 1;

        if (foraIndex > 0) {
          tasksSheet.getRange(existing.rowIndex, foraIndex).setValue(true);
        }
        if (lastSyncIndex > 0) {
          tasksSheet.getRange(existing.rowIndex, lastSyncIndex).setValue(timestamp);
        }

        outOfView++;
      }
    }

    const duration = new Date() - startTime;

    log('Sincronização com Sheet concluída', {
      fetched: tasks.length,
      upserted: upserted,
      updated: updated,
      inserted: inserted,
      outOfView: outOfView,
      durationMs: duration
    });

    return {
      ok: true,
      fetched: tasks.length,
      upserted: upserted,
      updated: updated,
      inserted: inserted,
      outOfView: outOfView,
      durationMs: duration
    };

  } catch (error) {
    log('Erro em syncClickUpViewToSheet', error.toString());
    logSyncError('syncClickUpViewToSheet', '', '', '', error.toString());
    return { ok: false, error: error.toString() };
  }
}

/**
 * Sincroniza tarefas do ClickUp para as rotinas internas
 */
function syncClickUpToRoutine() {
  try {
    const ss = getOrCreateSpreadsheet();
    const clickupSheet = ss.getSheetByName('CLICKUP_TASKS');

    if (!clickupSheet || clickupSheet.getLastRow() <= 1) {
      return { ok: true, synced: 0, message: 'Nenhuma tarefa do ClickUp para sincronizar' };
    }

    const data = clickupSheet.getDataRange().getValues();
    const headers = data[0];

    // Índices das colunas
    const taskIdIdx = headers.indexOf('task_id');
    const nameIdx = headers.indexOf('name');
    const statusIdx = headers.indexOf('status');
    const responsavelIdx = headers.indexOf('responsavel_principal');
    const responsavelEmailIdx = headers.indexOf('responsavel_email');
    const dueDateIdx = headers.indexOf('due_date');
    const foraViewIdx = headers.indexOf('fora_da_view');
    const priorityIdx = headers.indexOf('priority');

    const clickupTagPattern = /\[ClickUp:([^\]]+)\]/;
    const existingTasks = findRecords('TASKS', {});
    const existingByClickUpId = {};
    existingTasks.forEach(task => {
      if (!task.description) return;
      const match = String(task.description).match(clickupTagPattern);
      if (match && match[1]) {
        existingByClickUpId[String(match[1])] = task;
      }
    });

    function isEmailLike(value) {
      return typeof value === 'string' && value.indexOf('@') !== -1;
    }

    let synced = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const taskId = String(row[taskIdIdx]);
      const name = row[nameIdx];
      const status = row[statusIdx];
      const responsavel = row[responsavelIdx];
      const responsavelEmail = responsavelEmailIdx >= 0 ? String(row[responsavelEmailIdx] || '').trim() : '';
      const dueDate = row[dueDateIdx];
      const foraView = row[foraViewIdx];
      const priority = row[priorityIdx];

      // Pular se estiver fora da view
      if (foraView === true) {
        skipped++;
        continue;
      }

      try {
        // Buscar se já existe tarefa interna vinculada
        const linkedTask = existingByClickUpId[taskId];

        // Determinar status interno baseado no status do ClickUp
        let internalStatus = 'open';
        if (status && (status.toLowerCase().includes('complete') || status.toLowerCase().includes('closed'))) {
          internalStatus = 'done';
        } else if (status && status.toLowerCase().includes('progress')) {
          internalStatus = 'doing';
        }

        // Mapear prioridade
        let internalPriority = 'normal';
        if (priority) {
          const p = priority.toLowerCase();
          if (p === 'urgent') internalPriority = 'urgent';
          else if (p === 'high') internalPriority = 'high';
          else if (p === 'low') internalPriority = 'low';
        }

        // Buscar mapeamento de usuário
        let userKey = 'CLICKUP_SYNC';
        if (isEmailLike(responsavelEmail)) {
          userKey = responsavelEmail;
        } else if (isEmailLike(responsavel)) {
          userKey = String(responsavel).trim();
        } else if (responsavel) {
          const mapping = getUserMapping('', String(responsavel));
          if (mapping && mapping.emailInterno) {
            userKey = mapping.emailInterno;
          }
        }

        const taskData = {
          title: name,
          description: `[ClickUp:${taskId}]\n${name}\nURL: Ver no ClickUp`,
          priority: internalPriority,
          dueDate: dueDate ? new Date(parseInt(dueDate)).toISOString().split('T')[0] : '',
          status: internalStatus,
          tags: ['clickup-sync']
        };

        if (linkedTask) {
          // Atualizar tarefa existente
          const updates = {
            title: taskData.title,
            description: taskData.description,
            priority: taskData.priority,
            dueDate: taskData.dueDate,
            status: taskData.status,
            updatedAt: new Date().toISOString()
          };
          if (linkedTask.userKey === 'CLICKUP_SYNC' && userKey !== 'CLICKUP_SYNC') {
            updates.userKey = userKey;
          }
          updateRecord('TASKS', linkedTask.id, updates);
        } else {
          // Criar nova tarefa
          const newTask = {
            id: Utilities.getUuid(),
            userKey: userKey,
            ...taskData,
            tagsJson: JSON.stringify(taskData.tags),
            calendarEventId: '',
            calendarUpdatedAt: '',
            isRecurring: false,
            recurrenceType: '',
            recurrenceDays: '',
            recurrenceTime: '',
            recurrenceStartDate: '',
            recurrenceEndDate: '',
            recurrenceNextRun: '',
            templateTaskId: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          };

          createRecord('TASKS', newTask);
          existingByClickUpId[taskId] = newTask;
        }

        synced++;

      } catch (e) {
        log(`Erro ao sincronizar tarefa ${taskId}`, e.toString());
        errors++;
      }
    }

    return {
      ok: true,
      synced: synced,
      skipped: skipped,
      errors: errors
    };

  } catch (error) {
    log('Erro em syncClickUpToRoutine', error.toString());
    return { ok: false, error: error.toString() };
  }
}

/**
 * Orquestra toda a sincronização
 */
function syncAll() {
  const startTime = new Date();

  log('=== INICIANDO SYNC CLICKUP COMPLETO ===');

  try {
    // 1. Sincronizar da VIEW para Sheet
    const sheetResult = syncClickUpViewToSheet();
    if (!sheetResult.ok) {
      return sheetResult;
    }

    // 2. Sincronizar do Sheet para Rotinas Internas
    const routineResult = syncClickUpToRoutine();
    if (!routineResult.ok) {
      return { ...sheetResult, routineError: routineResult.error };
    }

    const totalDuration = new Date() - startTime;

    const result = {
      ok: true,
      timestamp: new Date().toISOString(),
      sheet: sheetResult,
      routine: routineResult,
      totalDurationMs: totalDuration
    };

    log('=== SYNC CLICKUP COMPLETO ===', result);

    // Salvar status do último sync
    PropertiesService.getScriptProperties().setProperty('LAST_CLICKUP_SYNC', JSON.stringify({
      timestamp: result.timestamp,
      success: true,
      summary: {
        fetched: sheetResult.fetched,
        synced: routineResult.synced,
        duration: totalDuration
      }
    }));

    return result;

  } catch (error) {
    log('Erro em syncAll', error.toString());
    logSyncError('syncAll', '', '', '', error.toString());

    PropertiesService.getScriptProperties().setProperty('LAST_CLICKUP_SYNC', JSON.stringify({
      timestamp: new Date().toISOString(),
      success: false,
      error: error.toString()
    }));

    return { ok: false, error: error.toString() };
  }
}

/**
 * Função exposta para o frontend - Sincronização manual
 */
function syncClickUpNow() {
  return safeExecute('syncClickUpNow', () => {
    return syncAll();
  });
}

/**
 * Obtém status da última sincronização
 */
function getLastSyncStatus() {
  try {
    const lastSync = PropertiesService.getScriptProperties().getProperty('LAST_CLICKUP_SYNC');
    if (!lastSync) {
      return { ok: true, lastSync: null };
    }

    const data = JSON.parse(lastSync);
    return { ok: true, lastSync: data };
  } catch (e) {
    return { ok: false, error: e.toString() };
  }
}

/**
 * Lista tarefas do ClickUp sincronizadas no sheet CLICKUP_TASKS
 */
function listClickUpTasks(options) {
  return safeExecute('listClickUpTasks', () => {
    const opts = options || {};
    const query = String(opts.query || '').trim().toLowerCase();
    const statusFilter = String(opts.status || 'all').trim().toLowerCase();
    const page = Math.max(1, parseInt(opts.page, 10) || 1);
    const pageSize = Math.max(1, parseInt(opts.pageSize, 10) || 25);
    const includeForaDaView = !!opts.includeForaDaView;

    const ss = getOrCreateSpreadsheet();
    const sheet = ss.getSheetByName('CLICKUP_TASKS');
    if (!sheet) {
      return { ok: false, error: 'Sheet CLICKUP_TASKS nao encontrada. Execute a sincronizacao do ClickUp.' };
    }

    if (sheet.getLastRow() <= 1) {
      return { ok: true, data: { items: [], total: 0, page: page, pageSize: pageSize } };
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    let currentUserEmail = String(opts.userKey || '').trim().toLowerCase();
    if (!currentUserEmail) {
      try {
        currentUserEmail = Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail();
      } catch (e) {}
      currentUserEmail = String(currentUserEmail || '').trim().toLowerCase();
    }

    const mappingByUsername = {};
    const mappingSheet = ss.getSheetByName('MAPEAMENTO_USUARIOS');
    if (mappingSheet && mappingSheet.getLastRow() > 1) {
      const mappingData = mappingSheet.getDataRange().getValues();
      for (let i = 1; i < mappingData.length; i++) {
        const row = mappingData[i];
        const clickupUsername = String(row[1] || '').trim().toLowerCase();
        const emailInterno = String(row[2] || '').trim().toLowerCase();
        const ativo = row[4];
        if (ativo && clickupUsername && emailInterno) {
          mappingByUsername[clickupUsername] = emailInterno;
        }
      }
    }

    function isTrue(value) {
      return value === true || String(value).toLowerCase() === 'true';
    }

    function isEmailLike(value) {
      return typeof value === 'string' && value.indexOf('@') !== -1;
    }

    function matchesStatus(rowStatus) {
      if (!statusFilter || statusFilter === 'all') return true;
      const status = String(rowStatus || '').toLowerCase();
      if (!status) return false;
      if (statusFilter === 'open') {
        return !(status.includes('done') || status.includes('closed') || status.includes('complete'));
      }
      if (statusFilter === 'doing') {
        return status.includes('doing') || status.includes('progress');
      }
      if (statusFilter === 'done') {
        return status.includes('done') || status.includes('closed') || status.includes('complete');
      }
      return status === statusFilter;
    }

    const filtered = [];
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const record = {};
      for (let j = 0; j < headers.length; j++) {
        record[headers[j]] = row[j];
      }

      if (!includeForaDaView && isTrue(record.fora_da_view)) {
        continue;
      }

      if (!matchesStatus(record.status)) {
        continue;
      }

      if (currentUserEmail) {
        let responsavelEmail = String(record.responsavel_email || '').trim().toLowerCase();
        const responsavelPrincipal = String(record.responsavel_principal || '').trim();
        if (!responsavelEmail && isEmailLike(responsavelPrincipal)) {
          responsavelEmail = responsavelPrincipal.toLowerCase();
        } else if (!responsavelEmail && responsavelPrincipal) {
          responsavelEmail = mappingByUsername[responsavelPrincipal.toLowerCase()] || '';
        }
        if (!responsavelEmail || responsavelEmail !== currentUserEmail) {
          continue;
        }
      }

      if (query) {
        const haystack = [
          record.name,
          record.responsavel_principal,
          record.responsavel_email,
          record.status,
          record.priority,
          record.assignees
        ].join(' ').toLowerCase();
        if (!haystack.includes(query)) {
          continue;
        }
      }

      filtered.push(record);
    }

    filtered.sort((a, b) => {
      const aVal = parseInt(a.date_updated, 10) || Date.parse(a.date_updated) || 0;
      const bVal = parseInt(b.date_updated, 10) || Date.parse(b.date_updated) || 0;
      return bVal - aVal;
    });

    const total = filtered.length;
    const start = (page - 1) * pageSize;
    const paged = filtered.slice(start, start + pageSize);

    const items = paged.map(record => ({
      task_id: record.task_id,
      task_url: record.task_url,
      name: record.name,
      status: record.status,
      priority: record.priority,
      responsavel_principal: record.responsavel_principal,
      responsavel_email: record.responsavel_email,
      due_date: record.due_date,
      date_updated: record.date_updated,
      fora_da_view: record.fora_da_view
    }));

    return { ok: true, data: { items: items, total: total, page: page, pageSize: pageSize } };
  });
}

/**
 * Cria ou atualiza trigger automÇ­tico de sincronizaÇõÇœo
 */
function createOrUpdateClickUpTrigger() {
  try {
    // Deletar triggers existentes
    const triggers = ScriptApp.getProjectTriggers();
    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'syncAll') {
        ScriptApp.deleteTrigger(trigger);
      }
    });

    // Criar novo trigger
    ScriptApp.newTrigger('syncAll')
      .timeBased()
      .everyMinutes(SYNC_INTERVAL_MIN)
      .create();

    log(`Trigger criado: sincronização a cada ${SYNC_INTERVAL_MIN} minutos`);

    return { ok: true, message: `Trigger criado com sucesso (${SYNC_INTERVAL_MIN} min)` };
  } catch (error) {
    log('Erro ao criar trigger', error.toString());
    return { ok: false, error: error.toString() };
  }
}

/**
 * Remove trigger automático
 */
function removeClickUpTrigger() {
  try {
    const triggers = ScriptApp.getProjectTriggers();
    let removed = 0;

    triggers.forEach(trigger => {
      if (trigger.getHandlerFunction() === 'syncAll') {
        ScriptApp.deleteTrigger(trigger);
        removed++;
      }
    });

    log(`${removed} trigger(s) removido(s)`);
    return { ok: true, message: `${removed} trigger(s) removido(s)` };
  } catch (error) {
    return { ok: false, error: error.toString() };
  }
}

