(function(){
  "use strict";

  let supabaseClient = null;
  let currentUser = null;

  let batchWords = [];
  let batchCurrentIndex = 0;
  let localHistory = [];
  let dbVocabulary = [];
  let dbAuditLogs = [];

  const $ = (sel) => document.querySelector(sel);
  
  const credentialsModal = $('#credentialsModal'), apiKeyInput = $('#apiKeyInput'), sbUrlInput = $('#sbUrlInput'), sbKeyInput = $('#sbKeyInput'), saveCredentialsBtn = $('#saveCredentialsBtn');
  const generateBtn = $('#generateBtn'), cardWrapper = $('#cardWrapper'), cardFlip = $('#cardFlip'), loaderSkeleton = $('#loaderSkeleton'), emptyState = $('#emptyState'), historyList = $('#historyList'), vocabGrid = $('#vocabGrid'), vocabEmpty = $('#vocabEmpty'), vocabFolders = $('#vocabFolders'), vocabSearch = $('#vocabSearch');
  const langSelect = $('#langSelect'), levelSelect = $('#levelSelect'), topicSelect = $('#topicSelect'), themeToggleBtn = $('#themeToggleBtn'), settingsModal = $('#settingsModal');
  const batchNav = $('#batchNav'), prevWordBtn = $('#prevWordBtn'), nextWordBtn = $('#nextWordBtn'), batchProgress = $('#batchProgress');
  const authModal = $('#authModal'), authBtn = $('#authBtn'), closeAuthBtn = $('#closeAuthBtn'), signInBtn = $('#signInBtn'), signUpBtn = $('#signUpBtn'), authEmail = $('#authEmail'), authPassword = $('#authPassword'), userDisplayBadge = $('#userDisplayBadge');

  const langFlags = {'английском':'🇬🇧','испанском':'🇪🇸','немецком':'🇩🇪','французском':'🇫🇷','итальянском':'🇮🇹'};
  const levelColors = {'A1':'#86EFAC','A2':'#86EFAC','B1':'#FDE047','B2':'#FDE047','C1':'#FCA5A5','C2':'#FCA5A5'};
  function getFlag(lang) { return langFlags[lang.toLowerCase()] || '✏️'; }
  function getLevelColor(level) { return levelColors[level] || 'var(--card-inner-bg)'; }

  function checkConfig() {
    const geminiKey = localStorage.getItem('wf_gemini_key');
    const sbUrl = localStorage.getItem('wf_sb_url');
    const sbKey = localStorage.getItem('wf_sb_key');

    if(geminiKey && sbUrl && sbKey) {
      if(credentialsModal) credentialsModal.classList.replace('flex', 'hidden');
      initSupabase(sbUrl, sbKey);
    } else {
      if(credentialsModal) credentialsModal.classList.replace('hidden', 'flex');
    }
  }

  if(saveCredentialsBtn) {
    saveCredentialsBtn.addEventListener('click', () => {
      const gk = apiKeyInput.value.trim();
      const url = sbUrlInput.value.trim();
      const key = sbKeyInput.value.trim();

      if(!gk || !url || !key) { showToast('Заполните все конфигурационные поля!', 'error'); return; }

      localStorage.setItem('wf_gemini_key', gk);
      localStorage.setItem('wf_sb_url', url);
      localStorage.setItem('wf_sb_key', key);
      
      showToast('Конфигурация сохранена локально', 'success');
      checkConfig();
    });
  }

  function initSupabase(url, key) {
    try {
      supabaseClient = supabase.createClient(url, key);
      supabaseClient.auth.onAuthStateChange((event, session) => {
        if (session && session.user) {
          currentUser = session.user;
          userDisplayBadge.textContent = currentUser.email;
          userDisplayBadge.classList.remove('hidden');
          authBtn.textContent = '🚪 Выйти';
          syncDataFromCloud();
        } else {
          currentUser = null;
          userDisplayBadge.classList.add('hidden');
          authBtn.textContent = '👤 Войти';
          dbVocabulary = [];
          dbAuditLogs = [];
          renderVocab();
          renderAuditLog();
        }
      });
    } catch(e) { showToast('Ошибка инициализации Supabase', 'error'); }
  }

  async function syncDataFromCloud() {
    if(!supabaseClient || !currentUser) return;
    const { data: vocabData } = await supabaseClient.from('vocabulary').select('*').eq('user_email', currentUser.email).order('created_at', { ascending: false });
    if(vocabData) dbVocabulary = vocabData;

    const { data: logData } = await supabaseClient.from('audit_log').select('*').eq('user_email', currentUser.email).order('created_at', { ascending: false });
    if(logData) dbAuditLogs = logData;

    renderVocab();
    renderAuditLog();
    updateDashboard();
  }

  async function cloudSaveWord(wordObj) {
    if(!supabaseClient || !currentUser) return;
    await supabaseClient.from('vocabulary').insert([{
      id: wordObj.id, user_email: currentUser.email, word: wordObj.word, translation: wordObj.translation,
      transcription: wordObj.transcription, lang: wordObj.lang, level: wordObj.level, category: wordObj.category,
      mastered: wordObj.mastered, examples: wordObj.examples
    }]);
    syncDataFromCloud();
  }

  async function cloudDeleteWord(id) {
    if(!supabaseClient || !currentUser) return;
    await supabaseClient.from('vocabulary').delete().eq('id', id);
    syncDataFromCloud();
  }

  async function cloudToggleMastered(id, currentStatus) {
    if(!supabaseClient || !currentUser) return;
    await supabaseClient.from('vocabulary').update({ mastered: !currentStatus }).eq('id', id);
    syncDataFromCloud();
  }

  async function cloudLogAction(word, type) {
    if(!supabaseClient || !currentUser) return;
    const timeStr = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    await supabaseClient.from('audit_log').insert([{ user_email: currentUser.email, word, type, time: timeStr }]);
    syncDataFromCloud();
  }

  authBtn.addEventListener('click', () => {
    if(currentUser) { supabaseClient.auth.signOut(); showToast('Вы вышли из облака', 'info'); } 
    else { authModal.classList.replace('hidden', 'flex'); }
  });
  closeAuthBtn.addEventListener('click', () => authModal.classList.replace('flex', 'hidden'));

  signUpBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim(); const password = authPassword.value.trim();
    if(!email || !password) { showToast('Заполните Email и пароль', 'error'); return; }
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if(error) showToast(error.message, 'error');
    else { showToast('Регистрация успешна! Войдите.', 'success'); }
  });

  signInBtn.addEventListener('click', async () => {
    const email = authEmail.value.trim(); const password = authPassword.value.trim();
    if(!email || !password) { showToast('Заполните Email и пароль', 'error'); return; }
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if(error) showToast(error.message, 'error');
    else { showToast('Успешный вход в облако! ☁️', 'success'); authModal.classList.replace('flex', 'hidden'); }
  });

  async function generateBatchWords() {
    if(!currentUser) { showToast('Сначала авторизуйтесь в облаке!', 'error'); authModal.classList.replace('hidden', 'flex'); return; }
    const geminiKey = localStorage.getItem('wf_gemini_key');

    emptyState.classList.add('hidden'); cardWrapper.classList.add('hidden'); batchNav.classList.add('hidden');
    loaderSkeleton.classList.remove('hidden'); generateBtn.disabled = true;

    const existingWords = [...localHistory.map(h => h.word.toLowerCase()), ...dbVocabulary.map(v => v.word.toLowerCase())];
    const uniqueExclusions = [...new Set(existingWords)].slice(0, 20);
    const exclusionPhrase = uniqueExclusions.length > 0 ? `НИ В КОЕМ СЛУЧАЕ не генерируй эти слова: [${uniqueExclusions.join(', ')}].` : '';

    const prompt = `Сгенерируй строго массив из 5 случайных, интересных, разных слов/выражений на языке ${langSelect.value} для уровня ${levelSelect.value} по теме "${topicSelect.value}". ${exclusionPhrase} ` +
      `Верни ТОЛЬКО валидный JSON-массив без markdown-разметки. Каждая запись структуры: ` +
      `{"word": "...", "translation": "...", "transcription": "...", "category": "...", "examples": [{"en":"...","ru":"..."}]}`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
      const resp = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }) });
      const data = await resp.json();
      let rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      let parsed = JSON.parse(rawText.replace(/```json|```/gi, '').trim());

      batchWords = parsed.map((item, idx) => ({ ...item, level: levelSelect.value, lang: langSelect.value, id: 'w_' + (Date.now() + idx), mastered: false }));
      batchCurrentIndex = 0; displayCurrentBatchWord();
      showToast('Подборка из 5 облачных слов готова!', 'success');
    } catch(e) { showToast('Ошибка ИИ. Попробуйте еще раз.', 'error'); emptyState.classList.remove('hidden'); } 
    finally { loaderSkeleton.classList.add('hidden'); generateBtn.disabled = false; }
  }

  function displayCurrentBatchWord() {
    if(batchWords.length === 0) return;
    const word = batchWords[batchCurrentIndex]; renderCard(word);
    if (!localHistory.some(h => h.word.toLowerCase() === word.word.toLowerCase())) {
      localHistory.unshift(word); renderHistory(); cloudLogAction(word.word, 'ИИ-генерация');
    }
    batchProgress.textContent = `Карточка ${batchCurrentIndex + 1} из ${batchWords.length}`;
    cardWrapper.classList.remove('hidden'); batchNav.classList.remove('hidden');
  }

  prevWordBtn.addEventListener('click', () => { if(batchCurrentIndex > 0) { batchCurrentIndex--; displayCurrentBatchWord(); } });
  nextWordBtn.addEventListener('click', () => { if(batchCurrentIndex < batchWords.length - 1) { batchCurrentIndex++; displayCurrentBatchWord(); } });

  function renderCard(word){
    cardFlip.classList.remove('flipped');
    $('#cardWord').textContent = word.word; $('#cardTranscription').textContent = word.transcription || '';
    $('#cardLevelBadge').textContent = word.level; $('#cardLevelBadge').style.backgroundColor = getLevelColor(word.level);
    $('#cardCategoryBadge').textContent = `${getFlag(word.lang)} ${word.category || topicSelect.value}`;
    $('#cardTranslation').textContent = word.translation;
    $('#cardExamples').innerHTML = (word.examples || []).map(ex => `
      <div class="brut-border rounded-lg p-3 text-left" style="background:var(--card-inner-bg); color:var(--ink);"><p class="font-semibold text-sm">${escapeHtml(ex.en)}</p><p class="text-xs opacity-70 mt-1">${escapeHtml(ex.ru)}</p></div>
    `).join('');
    updateFavIcon(word);
  }

  $('#addCustomWordBtn').addEventListener('click', () => {
    if(!currentUser) { showToast('Войдите, чтобы сохранять в облако', 'error'); return; }
    const wordVal = $('#customWord').value.trim(); const transVal = $('#customTranslation').value.trim();
    if(!wordVal || !transVal) { showToast('Заполните обязательные поля!', 'error'); return; }

    const newWord = {
      word: wordVal, translation: transVal, transcription: $('#customTranscription').value.trim(),
      lang: $('#customLang').value, level: $('#customLevel').value, category: 'Своё слово', id: 'custom_' + Date.now(), mastered: false, examples: []
    };
    cloudSaveWord(newWord); cloudLogAction(newWord.word, 'Ручной ввод');
    $('#customWord').value = ''; $('#customTranslation').value = ''; $('#customTranscription').value = '';
    showToast('Слово отправлено в Postgres! ☁️', 'success');
  });

  function renderHistory(){
    historyList.innerHTML = localHistory.map((word, index) => `
      <div class="w-full flex items-center justify-between bg-white brut-border rounded-lg p-2 mb-2" style="background:var(--card-inner-bg);">
        <span class="font-bold text-sm">${getFlag(word.lang)} ${escapeHtml(word.word)}</span>
        <button class="remove-hist font-black px-2 text-xs" data-idx="${index}">✕</button>
      </div>
    `).join('');
    document.querySelectorAll('.remove-hist').forEach(b => b.addEventListener('click', (e) => { localHistory.splice(e.target.dataset.idx, 1); renderHistory(); }));
  }

  function renderVocab(){
    renderVocabFolders();
    if(dbVocabulary.length === 0) { vocabGrid.innerHTML = ''; vocabEmpty.classList.remove('hidden'); return; }
    vocabEmpty.classList.add('hidden');

    const query = vocabSearch.value.trim().toLowerCase();
    let filtered = currentSelectedFolder === 'all' ? dbVocabulary : dbVocabulary.filter(w => w.lang.toLowerCase() === currentSelectedFolder.toLowerCase());
    if(query) filtered = filtered.filter(w => w.word.toLowerCase().includes(query));

    vocabGrid.innerHTML = filtered.map(word => `
      <div class="brut-border rounded-xl p-4 relative ${word.mastered ? 'mastered-card' : ''}" style="background:var(--card-inner-bg);">
        <h4 class="font-black text-lg">${getFlag(word.lang)} ${escapeHtml(word.word)}</h4>
        <p class="text-sm opacity-80">${escapeHtml(word.translation)}</p>
        <div class="flex justify-between items-center mt-3">
          <span class="px-2 py-0.5 rounded text-xs font-bold text-black" style="background:${getLevelColor(word.level)};">${word.level}</span>
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
    vocabFolders.innerHTML = ''; if (dbVocabulary.length === 0) return;
    const uniqueLangs = [...new Set(dbVocabulary.map(w => w.lang.toLowerCase()))];
    const buildBtn = (id, label, active) => {
      const b = document.createElement('button'); b.className = 'brut-border px-3 py-1.5 rounded-lg font-bold text-xs mr-2 mb-2';
      b.style.background = active ? 'var(--lime)' : 'var(--card-inner-bg)'; b.style.color = active ? '#000' : 'var(--ink)';
      b.textContent = label; b.addEventListener('click', () => { currentSelectedFolder = id; renderVocab(); });
      vocabFolders.appendChild(b);
    };
    buildBtn('all', `📁 Все (${dbVocabulary.length})`, currentSelectedFolder === 'all');
    uniqueLangs.forEach(l => buildBtn(l, `📁 ${getFlag(l)} ${l}`, currentSelectedFolder === l));
  }

  function renderAuditLog() {
    const container = $('#auditLogList'); if(!container) return;
    container.innerHTML = dbAuditLogs.map(log => `
      <div class="flex justify-between items-center bg-gray-50 dark:bg-gray-800 px-4 py-2.5 brut-border rounded-lg text-sm mb-2">
        <div><span class="font-bold">${escapeHtml(log.word)}</span> <span class="text-xs ml-2 px-2 py-0.5 rounded font-black bg-purple-200 text-purple-800">${log.type}</span></div>
        <span class="font-mono text-xs opacity-60">${log.time}</span>
      </div>
    `).join('');
  }

  function updateDashboard() {
    if($('#dashTotalWords')) $('#dashTotalWords').textContent = dbVocabulary.length;
    if($('#dashMasteredCount')) $('#dashMasteredCount').textContent = dbVocabulary.filter(w => w.mastered).length;
  }

  function updateFavIcon(word){ $('#favBtnFront').textContent = dbVocabulary.some(v=>v.word.toLowerCase() === word.word.toLowerCase()) ? '❤️' : '🤍'; }
  $('#favBtnFront').addEventListener('click', () => {
    const activeWord = batchWords[batchCurrentIndex];
    if(activeWord) {
      if(dbVocabulary.some(v=>v.word.toLowerCase() === activeWord.word.toLowerCase())) cloudDeleteWord(activeWord.id);
      else cloudSaveWord(activeWord);
    }
  });

  $('#settingsBtn').addEventListener('click', () => settingsModal.classList.replace('hidden', 'flex'));
  $('#closeSettingsBtn').addEventListener('click', () => settingsModal.classList.replace('flex', 'hidden'));
  $('#clearKeyBtn').addEventListener('click', () => {
    localStorage.clear(); showToast('Конфигурация сброшена', 'info'); window.location.reload();
  });

  function showToast(msg, type='info'){
    const colors = { info:'#F0B9ED', error:'#FCA5A5', success:'#E9FC94' };
    const el = document.createElement('div');
    el.className = 'toast brut-border brut-shadow-sm rounded-xl px-4 py-3 font-bold text-sm text-black';
    el.style.background = colors[type] || colors.info; el.textContent = msg;
    toastContainer.appendChild(el); setTimeout(()=>{ el.remove(); }, 4200);
  }

  function initTheme() {
    if (localStorage.getItem('wf_theme') === 'dark') { document.body.classList.add('dark-theme'); themeToggleBtn.textContent = '☀️'; } 
    else { themeToggleBtn.textContent = '🌙'; }
  }
  themeToggleBtn.addEventListener('click', () => {
    document.body.classList.toggle('dark-theme'); const isDark = document.body.classList.contains('dark-theme');
    localStorage.setItem('wf_theme', isDark ? 'dark' : 'light'); themeToggleBtn.textContent = isDark ? '☀️' : '🌙';
    renderVocab(); renderHistory();
  });

  function escapeHtml(str){ const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }
  $('#cardFront').addEventListener('click', () => cardFlip.classList.add('flipped'));
  $('#cardBack').addEventListener('click', () => cardFlip.classList.remove('flipped'));
  generateBtn.addEventListener('click', generateBatchWords);
  vocabSearch.addEventListener('input', renderVocab);

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden')); $('#tab-' + btn.dataset.tab).classList.remove('hidden');
    });
  });

  checkConfig();
})();