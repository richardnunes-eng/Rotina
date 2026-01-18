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
