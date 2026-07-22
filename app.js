(function () {
  "use strict";

  // Хранилище состояния
  let supabaseClient = null;
  let currentUser = null;
  let batchWords = [];
  let batchCurrentIndex = 0;
  let localHistory = [];
  let dbVocabulary = [];

  const $ = (sel) => document.querySelector(sel);

  // Безопасный вызов toast
  function showToast(msg, type = 'info') {
    const toastContainer = document.getElementById('toast-container') || document.body;
    const colors = { info: '#F0B9ED', error: '#FCA5A5', success: '#E9FC94' };
    const el = document.createElement('div');
    el.className = 'toast brut-border brut-shadow-sm rounded-xl px-4 py-3 font-bold text-sm text-black fixed bottom-4 right-4 z-50';
    el.style.background = colors[type] || colors.info;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => { el.remove(); }, 4000);
  }

  // --- 1. ПРОВЕРКА И СОХРАНЕНИЕ КОНФИГУРАЦИИ ---
  function checkConfig() {
    const geminiKey = localStorage.getItem('wf_gemini_key');
    const sbUrl = localStorage.getItem('wf_sb_url');
    const sbKey = localStorage.getItem('wf_sb_key');

    const credModal = $('#credentialsModal');

    if (geminiKey) {
      if (credModal) {
        credModal.classList.add('hidden');
        credModal.classList.remove('flex');
      }
      if (sbUrl && sbKey && typeof supabase !== 'undefined') {
        initSupabase(sbUrl, sbKey);
      }
    } else {
      if (credModal) {
        credModal.classList.remove('hidden');
        credModal.classList.add('flex');
      }
    }
  }

  // --- 2. ИНИЦИАЛИЗАЦИЯ SUPABASE ---
  function initSupabase(url, key) {
    try {
      if (typeof supabase === 'undefined') {
        console.warn("Supabase SDK не подключен в index.html");
        return;
      }
      supabaseClient = supabase.createClient(url, key);
      supabaseClient.auth.onAuthStateChange((event, session) => {
        const userBadge = $('#userDisplayBadge');
        const authBtn = $('#authBtn');

        if (session && session.user) {
          currentUser = session.user;
          if (userBadge) {
            userBadge.textContent = currentUser.email;
            userBadge.classList.remove('hidden');
          }
          if (authBtn) authBtn.textContent = '🚪 Выйти';
        } else {
          currentUser = null;
          if (userBadge) userBadge.classList.add('hidden');
          if (authBtn) authBtn.textContent = '👤 Войти';
        }
      });
    } catch (e) {
      console.error("Ошибка инициализации Supabase:", e);
    }
  }

  // --- 3. ГЕНЕРАЦИЯ СЛОВ ---
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

    const langSelect = $('#langSelect');
    const levelSelect = $('#levelSelect');
    const topicSelect = $('#topicSelect');

    const selectedLang = langSelect ? langSelect.value : 'English';
    const selectedLevel = levelSelect ? levelSelect.value : 'B1';
    const selectedTopic = topicSelect ? topicSelect.value : 'General';

    const prompt = `Generate a raw JSON array of 5 vocabulary words for learning ${selectedLang} at level ${selectedLevel} on topic "${selectedTopic}". ` +
      `Do NOT use markdown, code blocks, or extra text. Format strictly as: ` +
      `[{"word": "word", "translation": "перевод", "transcription": "[transcription]", "category": "${selectedTopic}", "examples": [{"en":"sentence1","ru":"перевод1"}]}]`;

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(geminiKey)}`;
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
        id: 'w_' + (Date.now() + idx)
      }));

      batchCurrentIndex = 0;
      displayWord();
      showToast('Подборка готова!', 'success');

    } catch (e) {
      console.error('AI Error:', e);
      showToast('Ошибка: ' + e.message, 'error');
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

    if (cardWord) cardWord.textContent = word.word;
    if (cardTranslation) cardTranslation.textContent = word.translation;
    if (cardTranscription) cardTranscription.textContent = word.transcription || '';
    if (batchProgress) batchProgress.textContent = `Карточка ${batchCurrentIndex + 1} из ${batchWords.length}`;

    if (cardWrapper) cardWrapper.classList.remove('hidden');
    if (batchNav) batchNav.classList.remove('hidden');
  }

  // --- 4. НАВЕШИВАНИЕ ОБРАБОТЧИКОВ (SAFE EVENT LISTENING) ---
  document.addEventListener('DOMContentLoaded', () => {
    checkConfig();

    // ⚙️ Кнопка Настроек / Шестерёнка
    const settingsBtn = $('#settingsBtn') || $('.lucide-settings')?.parentElement || $('button[title="Настройки"]');
    const settingsModal = $('#settingsModal') || $('#credentialsModal');
    const closeSettingsBtn = $('#closeSettingsBtn');

    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const modalToOpen = $('#credentialsModal') || $('#settingsModal');
        if (modalToOpen) {
          modalToOpen.classList.remove('hidden');
          modalToOpen.classList.add('flex');
        } else {
          showToast('Модальное окно настроек не найдено в HTML', 'error');
        }
      });
    }

    if (closeSettingsBtn) {
      closeSettingsBtn.addEventListener('click', () => {
        const modalToClose = $('#credentialsModal') || $('#settingsModal');
        if (modalToClose) {
          modalToClose.classList.add('hidden');
          modalToClose.classList.remove('flex');
        }
      });
    }

    // 💾 Сохранение ключей из формы
    const saveBtn = $('#saveCredentialsBtn') || $('#saveConfigBtn');
    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const gk = ($('#apiKeyInput') || $('#geminiKeyInput'))?.value.trim();
        const url = ($('#sbUrlInput') || $('#supabaseUrlInput'))?.value.trim();
        const key = ($('#sbKeyInput') || $('#supabaseKeyInput'))?.value.trim();

        if (!gk) {
          showToast('Введите Gemini API Key!', 'error');
          return;
        }

        localStorage.setItem('wf_gemini_key', gk);
        if (url) localStorage.setItem('wf_sb_url', url);
        if (key) localStorage.setItem('wf_sb_key', key);

        showToast('Настройки сохранены!', 'success');
        checkConfig();
      });
    }

    // 👤 Кнопка Входа / Регистрации
    const authBtn = $('#authBtn');
    const authModal = $('#authModal');
    const closeAuthBtn = $('#closeAuthBtn');

    if (authBtn) {
      authBtn.addEventListener('click', () => {
        if (currentUser && supabaseClient) {
          supabaseClient.auth.signOut();
          showToast('Вы вышли из системы', 'info');
        } else if (authModal) {
          authModal.classList.remove('hidden');
          authModal.classList.add('flex');
        } else {
          showToast('Форма входа не найдена в HTML', 'error');
        }
      });
    }

    if (closeAuthBtn && authModal) {
      closeAuthBtn.addEventListener('click', () => {
        authModal.classList.add('hidden');
        authModal.classList.remove('flex');
      });
    }

    // 🔑 Логин и Регистрация
    const signInBtn = $('#signInBtn');
    const signUpBtn = $('#signUpBtn');

    if (signInBtn) {
      signInBtn.addEventListener('click', async () => {
        if (!supabaseClient) { showToast('Сначала введите Supabase URL и Key!', 'error'); return; }
        const email = $('#authEmail')?.value.trim();
        const password = $('#authPassword')?.value.trim();
        if (!email || !password) { showToast('Заполните Email и пароль', 'error'); return; }

        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) showToast(error.message, 'error');
        else {
          showToast('Успешный вход! ☁️', 'success');
          if (authModal) authModal.classList.add('hidden');
        }
      });
    }

    if (signUpBtn) {
      signUpBtn.addEventListener('click', async () => {
        if (!supabaseClient) { showToast('Сначала введите Supabase URL и Key!', 'error'); return; }
        const email = $('#authEmail')?.value.trim();
        const password = $('#authPassword')?.value.trim();
        if (!email || !password) { showToast('Заполните Email и пароль', 'error'); return; }

        const { error } = await supabaseClient.auth.signUp({ email, password });
        if (error) showToast(error.message, 'error');
        else showToast('Регистрация успешна! Войдите.', 'success');
      });
    }

    // 🚀 Кнопка Генерации
    const generateBtn = $('#generateBtn');
    if (generateBtn) generateBtn.addEventListener('click', generateBatchWords);

    // 🔄 Навигация по карточкам
    const prevWordBtn = $('#prevWordBtn');
    const nextWordBtn = $('#nextWordBtn');
    if (prevWordBtn) prevWordBtn.addEventListener('click', () => { if (batchCurrentIndex > 0) { batchCurrentIndex--; displayWord(); } });
    if (nextWordBtn) nextWordBtn.addEventListener('click', () => { if (batchCurrentIndex < batchWords.length - 1) { batchCurrentIndex++; displayWord(); } });

    // 🧹 Сброс ключей
    const clearKeyBtn = $('#clearKeyBtn');
    if (clearKeyBtn) {
      clearKeyBtn.addEventListener('click', () => {
        localStorage.clear();
        showToast('Настройки сброшены', 'info');
        window.location.reload();
      });
    }
  });
})();