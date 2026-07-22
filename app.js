(function () {
  "use strict";

  // 🔴 ВСТАВЬ СВОИ ДАННЫЕ СЮДА (ОНИ ВШИТЫ В КОД ДЛЯ УДОБСТВА ПОЛЬЗОВАТЕЛЕЙ)
  const DEFAULT_SUPABASE_URL = "https://pdffpcfkovyfvagvobuy.supabase.co"; // Твой URL проекта
  const DEFAULT_SUPABASE_KEY = "sb_publishable_Ae6wkiEDjkirw-qTXZcCrA_2s3-PLU4";     // Твой Anon Key

  let supabaseClient = null;
  let currentUser = null;
  let batchWords = [];
  let batchCurrentIndex = 0;
  let localHistory = [];
  let dbVocabulary = [];
  let dbAuditLogs = [];
  let currentSelectedFolder = 'all';

  const $ = (sel) => document.querySelector(sel);

  const langFlags = { 'английском': '🇬🇧', 'испанском': '🇪🇸', 'немецком': '🇩🇪', 'французском': '🇫🇷', 'итальянском': '🇮🇹', 'english': '🇬🇧', 'german': '🇩🇪', 'spanish': '🇪🇸' };
  const levelColors = { 'A1': '#86EFAC', 'A2': '#86EFAC', 'B1': '#FDE047', 'B2': '#FDE047', 'C1': '#FCA5A5', 'C2': '#FCA5A5' };

  function getFlag(lang) { return langFlags[String(lang).toLowerCase()] || '✏️'; }
  function getLevelColor(level) { return levelColors[level] || 'var(--card-inner-bg, #fff)'; }

  function showToast(msg, type = 'info') {
    const toastContainer = document.getElementById('toast-container') || document.body;
    const colors = { info: '#F0B9ED', error: '#FCA5A5', success: '#E9FC94' };
    const el = document.createElement('div');
    el.className = 'toast brut-border brut-shadow-sm rounded-xl px-4 py-3 font-bold text-sm fixed bottom-4 right-4 z-50';
    el.style.color = 'var(--ink)';
    el.style.background = colors[type] || colors.info;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
  }

  // --- 1. ПРОВЕРКА И ИНИЦИАЛИЗАЦИЯ ---
  function checkConfig() {
    const geminiKey = localStorage.getItem('wf_gemini_key');
    const credModal = $('#credentialsModal');

    if (geminiKey) {
      if (credModal) {
        credModal.classList.add('hidden');
        credModal.classList.remove('flex');
      }
    } else {
      if (credModal) {
        credModal.classList.remove('hidden');
        credModal.classList.add('flex');
      }
    }
    
    // Автоматически запускаем Supabase с дефолтными ключами
    if (typeof supabase !== 'undefined' && !supabaseClient) {
      initSupabase(DEFAULT_SUPABASE_URL, DEFAULT_SUPABASE_KEY);
    }
  }

  // --- 2. SUPABASE SDK ---
  function initSupabase(url, key) {
    try {
      supabaseClient = supabase.createClient(url, key);
      supabaseClient.auth.onAuthStateChange((event, session) => {
        const userEmailDisplay = $('#userEmailDisplay');
        const userEmailText = userEmailDisplay?.querySelector('.user-email-text');
        const authBtn = $('#authBtn');

        if (session && session.user) {
          currentUser = session.user;
          if (userEmailDisplay && userEmailText) {
            userEmailText.textContent = currentUser.email;
            userEmailDisplay.classList.remove('hidden');
            userEmailDisplay.title = currentUser.email;
          }
          if (authBtn) authBtn.textContent = '🚪 Выйти';
          syncDataFromCloud();
        } else {
          currentUser = null;
          if (userEmailDisplay) userEmailDisplay.classList.add('hidden');
          if (authBtn) authBtn.textContent = '👤 Войти';
          dbVocabulary = [];
          dbAuditLogs = [];
          renderVocab();
          renderAuditLog();
        }
      });
    } catch (e) {
      console.error("Ошибка инициализации Supabase:", e);
    }
  }

  async function syncDataFromCloud() {
    if (!supabaseClient || !currentUser) return;
    try {
      const { data: vocabData } = await supabaseClient.from('vocabulary').select('*').eq('user_email', currentUser.email).order('created_at', { ascending: false });
      if (vocabData) dbVocabulary = vocabData;

      const { data: logData } = await supabaseClient.from('audit_log').select('*').eq('user_email', currentUser.email).order('created_at', { ascending: false });
      if (logData) dbAuditLogs = logData;

      renderVocab();
      renderAuditLog();
      updateDashboard();
    } catch (err) {
      console.error('Cloud Sync Error:', err);
    }
  }

  async function cloudSaveWord(wordObj) {
    if (!supabaseClient || !currentUser) return;
    await supabaseClient.from('vocabulary').insert([{
      id: wordObj.id, user_email: currentUser.email, word: wordObj.word, translation: wordObj.translation,
      transcription: wordObj.transcription, lang: wordObj.lang, level: wordObj.level, category: wordObj.category,
      mastered: wordObj.mastered, examples: wordObj.examples
    }]);
    syncDataFromCloud();
  }

  async function cloudDeleteWord(id) {
    if (!supabaseClient || !currentUser) return;
    const word = dbVocabulary.find(w => w.id === id);
    await supabaseClient.from('vocabulary').delete().eq('id', id);
    syncDataFromCloud();
    showToast(`🗑️ "${word?.word || 'слово'}" удалено из словаря`, 'info');
  }

  async function cloudToggleMastered(id, currentStatus) {
    if (!supabaseClient || !currentUser) return;
    await supabaseClient.from('vocabulary').update({ mastered: !currentStatus }).eq('id', id);
    syncDataFromCloud();
  }

  async function cloudLogAction(word, type) {
    if (!supabaseClient || !currentUser) return;
    const timeStr = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await supabaseClient.from('audit_log').insert([{ user_email: currentUser.email, word, type, time: timeStr }]);
    syncDataFromCloud();
  }

  // --- 3. ГЕНЕРАЦИЯ СЛОВ (Используем модель gemini-2.5-flash) ---
  async function generateBatchWords() {
    const geminiKey = localStorage.getItem('wf_gemini_key');
    if (!geminiKey) {
      showToast('Сначала введите Gemini API Key!', 'error');
      const credModal = $('#credentialsModal');
      if (credModal) {
        credModal.classList.remove('hidden');
        credModal.classList.add('flex');
      }
      return;
    }

    const generateBtn = $('#generateBtn');
    const loaderSkeleton = $('#loaderSkeleton');
    const emptyState = $('#emptyState');
    const cardWrapper = $('#cardWrapper');
    const batchNav = $('#batchNav');

    if (emptyState) emptyState.classList.add('hidden');
    if (cardWrapper) cardWrapper.classList.add('hidden');
    if (batchNav) batchNav.classList.add('hidden');
    if (loaderSkeleton) loaderSkeleton.classList.remove('hidden');
    if (generateBtn) generateBtn.disabled = true;

    const selectedLang = $('#langSelect') ? $('#langSelect').value : 'английском';
    const selectedLevel = $('#levelSelect') ? $('#levelSelect').value : 'B1';
    const selectedTopic = $('#topicSelect') ? $('#topicSelect').value : 'Разговорный';

    const existingWords = [...localHistory.map(h => h.word.toLowerCase()), ...dbVocabulary.map(v => v.word.toLowerCase())];
    const uniqueExclusions = [...new Set(existingWords)].slice(0, 15);
    const exclusionPhrase = uniqueExclusions.length > 0 ? `НЕ используй эти слова: [${uniqueExclusions.join(', ')}].` : '';

    const prompt = `Сгенерируй строго массив из 5 случайных слов/выражений на языке ${selectedLang} для уровня ${selectedLevel} по теме "${selectedTopic}". ${exclusionPhrase} ` +
      `Верни ТОЛЬКО валидный JSON-массив без markdown разметки. Формат: ` +
      `[{"word": "word", "translation": "перевод", "transcription": "[transcription]", "category": "${selectedTopic}", "examples": [{"en":"sentence1","ru":"перевод1"},{"en":"sentence2","ru":"перевод2"},{"en":"sentence3","ru":"перевод3"}]}]`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      });

      const data = await resp.json();
      if (data.error) throw new Error(data.error.message || 'Ошибка API Google');

      let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      let parsed = JSON.parse(rawText.replace(/```json|```/gi, '').trim());

      batchWords = parsed.map((item, idx) => ({
        ...item,
        level: selectedLevel,
        lang: selectedLang,
        id: 'w_' + (Date.now() + idx),
        mastered: false
      }));

      batchCurrentIndex = 0;
      displayWord();
      showToast('Подборка готова!', 'success');

    } catch (e) {
      console.error('AI Error:', e);
      showToast('Ошибка ИИ: ' + e.message, 'error');
      if (emptyState) emptyState.classList.remove('hidden');
    } finally {
      if (loaderSkeleton) loaderSkeleton.classList.add('hidden');
      if (generateBtn) generateBtn.disabled = false;
    }
  }

function displayWord() {
    if (batchWords.length === 0) return;
    const word = batchWords[batchCurrentIndex];

    const cardWord = $('#cardWord');
    const cardTranslation = $('#cardTranslation');
    const cardTranscription = $('#cardTranscription');
    const cardWrapper = $('#cardWrapper');
    const batchNav = $('#batchNav');
    const batchProgress = $('#batchProgress');
    const cardFlip = $('#cardFlip');

    if (cardFlip) cardFlip.classList.remove('flipped');
    if (cardWord) cardWord.textContent = word.word;
    if (cardTranslation) cardTranslation.textContent = word.translation;
    if (cardTranscription) cardTranscription.textContent = word.transcription ? `[ ${word.transcription} ]` : '';
    if (batchProgress) batchProgress.textContent = `Карточка ${batchCurrentIndex + 1} из ${batchWords.length}`;

    if ($('#cardLevelBadge')) {
      $('#cardLevelBadge').textContent = word.level;
      $('#cardLevelBadge').style.backgroundColor = getLevelColor(word.level);
    }
    if ($('#cardCategoryBadge')) $('#cardCategoryBadge').textContent = `${getFlag(word.lang)} ${word.category || 'Общее'}`;

    if ($('#cardExamples')) {
      $('#cardExamples').innerHTML = (word.examples || []).map(ex => `
        <div class="brut-border rounded-xl p-3 text-left mb-2 bg-white" style="background:var(--card-inner-bg, #fff); color:var(--ink, #000);">
          <p class="font-semibold text-sm">${escapeHtml(ex.en || ex.word || '')}</p>
          <p class="text-xs opacity-70 mt-1">${escapeHtml(ex.ru || ex.translation || '')}</p>
        </div>
      `).join('');
    }

    if (!localHistory.some(h => h.word.toLowerCase() === word.word.toLowerCase())) {
      localHistory.unshift(word);
      renderHistory();
      cloudLogAction(word.word, 'ИИ-генерация');
    }

    if (cardWrapper) cardWrapper.classList.remove('hidden');
    if (batchNav) batchNav.classList.remove('hidden');
    updateFavIcon(word);
  }

  function updateFavIcon(word) {
    const favBtn = $('#favBtnFront');
    if (!favBtn || !word) return;
    const isSaved = dbVocabulary.some(v => v.word.toLowerCase() === word.word.toLowerCase());
    favBtn.textContent = isSaved ? '❤️' : '🤍';
  }

  // --- 4. ОТРЕСОВКА И ИНТЕРФЕЙС ---
  function renderHistory() {
    const historyList = $('#historyList');
    if (!historyList) return;
    historyList.innerHTML = localHistory.map((word, index) => `
      <div class="w-full flex items-center justify-between brut-border rounded-lg p-2 mb-2" style="background:var(--card-inner-bg); color:var(--ink);">
        <span class="font-bold text-sm">${getFlag(word.lang)} ${escapeHtml(word.word)}</span>
        <button class="remove-hist font-black px-2 text-xs" data-idx="${index}">✕</button>
      </div>
    `).join('');

    document.querySelectorAll('.remove-hist').forEach(b => b.addEventListener('click', (e) => {
      localHistory.splice(e.target.dataset.idx, 1);
      renderHistory();
    }));
  }

  function renderVocab() {
    renderVocabFolders();
    const vocabGrid = $('#vocabGrid');
    const vocabEmpty = $('#vocabEmpty');
    if (!vocabGrid) return;

    if (dbVocabulary.length === 0) {
      vocabGrid.innerHTML = '';
      if (vocabEmpty) vocabEmpty.classList.remove('hidden');
      return;
    }
    if (vocabEmpty) vocabEmpty.classList.add('hidden');

    const query = $('#vocabSearch') ? $('#vocabSearch').value.trim().toLowerCase() : '';
    let filtered = currentSelectedFolder === 'all' ? dbVocabulary : dbVocabulary.filter(w => String(w.lang).toLowerCase() === currentSelectedFolder.toLowerCase());
    if (query) filtered = filtered.filter(w => w.word.toLowerCase().includes(query));

    vocabGrid.innerHTML = filtered.map(word => `
      <div class="brut-border rounded-xl p-4 relative ${word.mastered ? 'mastered-card' : ''}" style="background:var(--card-inner-bg);">
        <h4 class="font-black text-lg">${getFlag(word.lang)} ${escapeHtml(word.word)}</h4>
        <p class="text-sm opacity-80">${escapeHtml(word.translation)}</p>
        <div class="flex justify-between items-center mt-3">
          <span class="px-2 py-0.5 rounded text-xs font-bold" style="background:${getLevelColor(word.level)}; color:var(--ink);">${word.level}</span>
          <div class="flex gap-2">
            <button class="toggle-master text-lg" data-id="${word.id}" data-status="${word.mastered}">${word.mastered ? '✔️' : '☑️'}</button>
            <button class="del-word text-lg" data-id="${word.id}">🗑️</button>
          </div>
        </div>
      </div>
    `).join('');

    document.querySelectorAll('.del-word').forEach(b => b.addEventListener('click', (e) => cloudDeleteWord(e.target.dataset.id)));
    document.querySelectorAll('.toggle-master').forEach(b => b.addEventListener('click', (e) => cloudToggleMastered(e.target.dataset.id, e.target.dataset.status === 'true')));
  }

  function renderVocabFolders() {
    const vocabFolders = $('#vocabFolders');
    if (!vocabFolders) return;
    vocabFolders.innerHTML = '';
    if (dbVocabulary.length === 0) return;

    const uniqueLangs = [...new Set(dbVocabulary.map(w => String(w.lang).toLowerCase()))];
    const buildBtn = (id, label, active) => {
      const b = document.createElement('button');
      b.className = 'brut-border px-3 py-1.5 rounded-lg font-bold text-xs mr-2 mb-2';
      b.style.background = active ? 'var(--lime, #a3e635)' : 'var(--card-inner-bg, #fff)';
      b.style.color = active ? '#000' : 'var(--ink, #000)';
      b.textContent = label;
      b.addEventListener('click', () => { currentSelectedFolder = id; renderVocab(); });
      vocabFolders.appendChild(b);
    };

    buildBtn('all', `📁 Все (${dbVocabulary.length})`, currentSelectedFolder === 'all');
    uniqueLangs.forEach(l => buildBtn(l, `📁 ${getFlag(l)} ${l}`, currentSelectedFolder === l));
  }

  function renderAuditLog() {
    const container = $('#auditLogList');
    if (!container) return;
    container.innerHTML = dbAuditLogs.map(log => `
      <div class="flex justify-between items-center px-4 py-2.5 brut-border rounded-lg text-sm mb-2" style="background:var(--card-inner-bg); color:var(--ink);">
        <div class="flex items-center gap-2">
          <span class="font-bold">${escapeHtml(log.word)}</span>
          <span class="text-xs px-2 py-0.5 rounded font-black" style="background:var(--lavender); color:var(--ink);">${log.type}</span>
          <button class="save-from-log text-xs brut-border rounded px-2 py-0.5 font-black" data-word="${escapeHtml(log.word)}" style="background:var(--lime); color:#000;">❤️</button>
        </div>
        <span class="font-mono text-xs opacity-60">${log.time}</span>
      </div>
    `).join('');

    // Сохранение слова из лога в словарь
    container.querySelectorAll('.save-from-log').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const wordText = e.target.dataset.word;
        if (!wordText) return;

        // Проверка, есть ли уже в словаре
        if (dbVocabulary.some(w => w.word.toLowerCase() === wordText.toLowerCase())) {
          showToast(`"${wordText}" уже в словаре`, 'info');
          return;
        }

        const geminiKey = localStorage.getItem('wf_gemini_key');
        const newWord = {
          word: wordText,
          translation: '—',
          transcription: '',
          lang: 'английском',
          level: 'B1',
          category: 'Из лога',
          id: 'log_' + Date.now(),
          mastered: false,
          examples: []
        };

        // AI-улучшение
        if (geminiKey && typeof enhanceWordWithAI === 'function') {
          const enhanced = await enhanceWordWithAI(wordText, 'английском', '', '', geminiKey);
          if (enhanced.translation) newWord.translation = enhanced.translation;
          if (enhanced.level) newWord.level = enhanced.level;
          if (enhanced.examples.length > 0) newWord.examples = enhanced.examples;
        }

        if (currentUser) {
          cloudSaveWord(newWord);
          cloudLogAction(newWord.word, 'Из лога');
        } else {
          dbVocabulary.unshift(newWord);
          renderVocab();
        }
        showToast(`❤️ "${wordText}" сохранено в словарь`, 'success');
      });
    });
  }

  function updateDashboard() {
    if ($('#dashTotalWords')) $('#dashTotalWords').textContent = dbVocabulary.length;
    if ($('#dashMasteredCount')) $('#dashMasteredCount').textContent = dbVocabulary.filter(w => w.mastered).length;
  }

  function updateFavIcon(word) {
    if ($('#favBtnFront')) {
      $('#favBtnFront').textContent = dbVocabulary.some(v => v.word.toLowerCase() === word.word.toLowerCase()) ? '❤️' : '🤍';
    }
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
  }

  // --- 5. ОБРАБОТКА СОБЫТИЙ ---
  document.addEventListener('DOMContentLoaded', () => {
    checkConfig();

    if (localStorage.getItem('wf_streak') && $('#streakCount')) {
      $('#streakCount').textContent = localStorage.getItem('wf_streak');
    }

    // Вкладки
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
        const targetTab = $('#tab-' + btn.dataset.tab);
        if (targetTab) targetTab.classList.remove('hidden');
      });
    });

    // Настройки (Шестерёнка)
    const settingsBtn = $('#settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const modal = $('#credentialsModal');
        if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
      });
    }

    // Сохранение ключа Gemini
    const saveBtn = $('#saveCredentialsBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const gk = $('#apiKeyInput') ? $('#apiKeyInput').value.trim() : '';
        if (!gk) { showToast('Введите Gemini API Key!', 'error'); return; }

        localStorage.setItem('wf_gemini_key', gk);
        showToast('Ключ ИИ сохранён!', 'success');
        checkConfig();
      });
    }

    // Авторизация
    const authBtn = $('#authBtn');
    const authModal = $('#authModal');
    const closeAuthBtn = $('#closeAuthBtn');

    if (authBtn) {
      authBtn.addEventListener('click', () => {
        if (currentUser && supabaseClient) {
          supabaseClient.auth.signOut();
          showToast('Вы вышли из профиля', 'info');
        } else if (authModal) {
          authModal.classList.remove('hidden');
          authModal.classList.add('flex');
        }
      });
    }

    if (closeAuthBtn && authModal) {
      closeAuthBtn.addEventListener('click', () => {
        authModal.classList.add('hidden');
        authModal.classList.remove('flex');
      });
    }

    const signInBtn = $('#signInBtn');
    const signUpBtn = $('#signUpBtn');

    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        const email = $('#authEmail') ? $('#authEmail').value.trim() : '';
        const password = $('#authPassword') ? $('#authPassword').value.trim() : '';
        if (!email || !password) { showToast('Заполните Email и пароль', 'error'); return; }

        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) showToast(error.message, 'error');
        else {
          showToast('Успешный вход в профиль! ☁️', 'success');
          if (authModal) { authModal.classList.add('hidden'); authModal.classList.remove('flex'); }
        }
      });
    }

    if (signUpBtn) {
      signUpBtn.addEventListener('click', async () => {
        const email = $('#authEmail') ? $('#authEmail').value.trim() : '';
        const password = $('#authPassword') ? $('#authPassword').value.trim() : '';
        if (!email || !password) { showToast('Заполните Email и пароль', 'error'); return; }

        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) showToast(error.message, 'error');
        else showToast('Регистрация успешна! Теперь нажмите Войти.', 'success');
      });
    }

    // Генерация и навигация
    if ($('#generateBtn')) $('#generateBtn').addEventListener('click', generateBatchWords);
    if ($('#prevWordBtn')) $('#prevWordBtn').addEventListener('click', () => { if (batchCurrentIndex > 0) { batchCurrentIndex--; displayWord(); } });
    if ($('#nextWordBtn')) $('#nextWordBtn').addEventListener('click', () => { if (batchCurrentIndex < batchWords.length - 1) { batchCurrentIndex++; displayWord(); } });

    // Карточка и Избранное
    const cardFront = $('#cardFront');
    const cardBack = $('#cardBack');
    const cardFlip = $('#cardFlip');
    if (cardFront && cardFlip) {
      cardFront.addEventListener('click', (e) => {
        // Если кликнули по сердечку или динамику — НЕ переворачиваем карточку
        if (e.target.closest('#favBtnFront') || e.target.closest('#speakBtn')) return;
        cardFlip.classList.add('flipped');
      });
    }

    if (cardBack && cardFlip) {
      cardBack.addEventListener('click', () => cardFlip.classList.remove('flipped'));
    }

 const favBtnFront = $('#favBtnFront');
    if (favBtnFront) {
      favBtnFront.addEventListener('click', (e) => {
        e.stopPropagation(); // Блокируем всплытие, чтобы карточка не переворачивалась
        const activeWord = batchWords[batchCurrentIndex];
        if (!activeWord) return;

        const isSaved = dbVocabulary.some(v => v.word.toLowerCase() === activeWord.word.toLowerCase());

        if (isSaved) {
          dbVocabulary = dbVocabulary.filter(v => v.word.toLowerCase() !== activeWord.word.toLowerCase());
          cloudDeleteWord(activeWord.id);
          showToast('Удалено из словаря', 'info');
        } else {
          dbVocabulary.unshift(activeWord);
          cloudSaveWord(activeWord);
          showToast('Сохранено в словарь! ❤️', 'success');
        }
        updateFavIcon(activeWord);
        renderVocab();
      });
    }

const speakBtn = $('#speakBtn');
    if (speakBtn) {
      speakBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const activeWord = batchWords[batchCurrentIndex];
        if (!activeWord) return;
        
        const utterance = new SpeechSynthesisUtterance(activeWord.word);
        utterance.lang = 'en-US';
        window.speechSynthesis.speak(utterance);
      });
    }

    // Улучшение слова через AI: перевод, уровень, примеры
    async function enhanceWordWithAI(wordVal, lang, existingTranslation, existingLevel, geminiKey) {
      const result = { translation: existingTranslation, level: existingLevel, examples: [] };

      try {
        const needTranslation = !existingTranslation;
        const needLevel = !existingLevel || existingLevel === 'B1'; // B1 — заглушка по умолчанию, значит не указан
        const prompt = `Проанализируй слово "${wordVal}" на ${lang} языке.${needTranslation ? ` Дай перевод на русский.` : ''}${needLevel ? ` Определи уровень языка (A1, A2, B1, B2, C1, C2).` : ''} Сгенерируй 3 примера предложений с переводом на русский. Верни ТОЛЬКО валидный JSON без markdown: {"translation":"${needTranslation ? 'перевод' : existingTranslation}","level":"${needLevel ? 'B1' : existingLevel}","examples":[{"en":"sentence1","ru":"перевод1"},{"en":"sentence2","ru":"перевод2"},{"en":"sentence3","ru":"перевод3"}]}`;

        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await resp.json();
        if (data.error) throw new Error(data.error.message);

        let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const enhanced = JSON.parse(rawText.replace(/```json|```/gi, '').trim());

        if (enhanced.translation) result.translation = enhanced.translation;
        if (enhanced.level) result.level = enhanced.level;
        if (enhanced.examples && enhanced.examples.length > 0) result.examples = enhanced.examples;
      } catch (e) {
        console.error('AI Enhancement Error:', e);
      }

      return result;
    }

    // Добавление кастомного слова
    if ($('#addCustomWordBtn')) {
      $('#addCustomWordBtn').addEventListener('click', async () => {
        const wordVal = $('#customWord') ? $('#customWord').value.trim() : '';
        if (!wordVal) { showToast('Введите слово!', 'error'); return; }

        const transVal = $('#customTranslation') ? $('#customTranslation').value.trim() : '';
        const selectedLang = $('#customLang') ? $('#customLang').value : 'английском';
        const selectedLevel = $('#customLevel') ? $('#customLevel').value : 'B1';
        const geminiKey = localStorage.getItem('wf_gemini_key');

        // Показываем загрузку
        const addBtn = $('#addCustomWordBtn');
        const originalText = addBtn.textContent;
        addBtn.textContent = '⏳ Генерация...';
        addBtn.disabled = true;

        const newWord = {
          word: wordVal,
          translation: transVal || '—',
          transcription: '',
          lang: selectedLang,
          level: 'B1',
          category: 'Своё слово',
          id: 'custom_' + Date.now(),
          mastered: false,
          examples: []
        };

        // AI-улучшение: перевод, уровень, примеры
        if (geminiKey) {
          const enhanced = await enhanceWordWithAI(wordVal, selectedLang, transVal, '', geminiKey);
          if (enhanced.translation) newWord.translation = enhanced.translation;
          if (enhanced.level) newWord.level = enhanced.level;
          if (enhanced.examples.length > 0) newWord.examples = enhanced.examples;
        }

        if (currentUser) {
          cloudSaveWord(newWord);
          cloudLogAction(newWord.word, 'Ручной ввод');
        } else {
          dbVocabulary.unshift(newWord);
          renderVocab();
        }

        if ($('#customWord')) $('#customWord').value = '';
        if ($('#customTranslation')) $('#customTranslation').value = '';

        addBtn.textContent = originalText;
        addBtn.disabled = false;
        showToast('Слово сохранено!', 'success');
      });
    }

    // Поиск
    if ($('#vocabSearch')) $('#vocabSearch').addEventListener('input', renderVocab);

    // Переключение темы
    const themeToggleBtn = $('#themeToggleBtn');
    if (themeToggleBtn) {
      if (localStorage.getItem('wf_theme') === 'dark') {
        document.body.classList.add('dark-theme');
        themeToggleBtn.textContent = '☀️';
      } else {
        themeToggleBtn.textContent = '🌙';
      }

      themeToggleBtn.addEventListener('click', () => {
        document.body.classList.toggle('dark-theme');
        const isDark = document.body.classList.contains('dark-theme');
        localStorage.setItem('wf_theme', isDark ? 'dark' : 'light');
        themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
        renderVocab();
        renderHistory();
      });
    }
  });
})();