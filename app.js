/* ==========================================================================
   LÓGICA DEL SIMULADOR EXAMEN DE LEYES - APP.JS
   ========================================================================== */

/* ========================================================================
   CONSTANTES DE CONFIGURACIÓN DE JSONBIN.IO
   ======================================================================== */
const BIN_ID  = '6a64e945f5f4af5e29c05796';
const API_KEY = '$2a$10$jeatA89HqzJB/Co/naO1Z.7peyWb/OURz.26nLWmIkzXA.PrvtCay';

class ANTSimulatorApp {
  constructor() {
    this.STORAGE_KEY = 'SIMULADOR_EXAMEN_LEYES_V9';
    
    // Estado General
    this.questions = [];
    this.currentRole = 'student'; // 'student' | 'admin'
    this.currentMode = 'exam'; // 'exam' | 'study' | 'random20'
    this.isAdminLoggedIn = false; // Login de administrador

    // Estado del Examen Activo
    this.examState = {
      questions: [],
      answers: {},       // { questionId: selectedOptionIndex }
      timerInterval: null,
      elapsedSeconds: 0,
      isFinished: false
    };

    // Filtro de Revisión
    this.reviewFilter = 'all';

    // Control de toast
    this._toastTimer = null;

    // Inicializar
    this.init();
  }

  init() {
    this.loadQuestionsFromCloud();
  }

  /* ========================================================================
     LIMPIEZA DE PREFIJOS (ELIMINA "1. a.", "2. b.", "a.", "1.", etc.)
     ======================================================================== */
  cleanOptionText(text) {
    if (!text) return '';
    let str = String(text).trim();
    return str.replace(/^([0-9]+[\.\)\-]\s*)?([a-eA-E][\.\)\-]\s*)?/, '').trim();
  }

  cleanQuestionText(text) {
    if (!text) return '';
    let str = String(text).trim();
    return str.replace(/^(Pregunta\s*\d+[\:\.\-]?\s*|\d+[\.\)\-]\s*)/i, '').trim();
  }

  /* ========================================================================
     SISTEMA DE NOTIFICACIONES TOAST (NUBE)
     ======================================================================== */
  showCloudToast(message, type = 'loading') {
    const toast = document.getElementById('cloud-toast');
    const icon  = document.getElementById('cloud-toast-icon');
    const msg   = document.getElementById('cloud-toast-msg');
    if (!toast) return;

    // Limpiar clases previas
    toast.classList.remove('toast-success', 'toast-error', 'visible');

    // Icono según tipo
    if (type === 'loading')      { icon.textContent = '☁️'; }
    else if (type === 'success') { icon.textContent = '✅'; toast.classList.add('toast-success'); }
    else if (type === 'error')   { icon.textContent = '❌'; toast.classList.add('toast-error'); }

    msg.textContent = message;

    // Mostrar
    clearTimeout(this._toastTimer);
    // Forzar reflow para re-trigger animación
    void toast.offsetWidth;
    toast.classList.add('visible');

    // Auto-ocultar tras 3s (salvo loading, que se cierra manualmente)
    if (type !== 'loading') {
      this._toastTimer = setTimeout(() => {
        toast.classList.remove('visible');
      }, 3000);
    }
  }

  hideCloudToast() {
    const toast = document.getElementById('cloud-toast');
    if (toast) toast.classList.remove('visible');
    clearTimeout(this._toastTimer);
  }

  /* ========================================================================
     GESTIÓN DE PREGUNTAS – JSONBIN.IO + LOCALSTORAGE (CACHE)
     ======================================================================== */

  /** Carga inicial: intenta traer de la nube, fallback a localStorage */
  async loadQuestionsFromCloud() {
    this.showCloudToast('Cargando preguntas de la nube...', 'loading');
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, {
        method: 'GET',
        headers: { 'X-Master-Key': API_KEY }
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} al cargar desde JSONBin`);

      const data = await res.json();
      console.log('JSONBin GET respuesta:', data);

      const record = data.record;

      if (Array.isArray(record) && record.length > 0) {
        this.questions = this.normalizeQuestionsArray(record);
        this.saveQuestionsToLocalStorage();
        this.showCloudToast(`${this.questions.length} preguntas cargadas de la nube`, 'success');
      } else {
        // El bin está vacío: usar localStorage o defaults
        this.loadQuestionsFromLocalStorage();
        this.showCloudToast('Nube vacía — usando datos locales', 'success');
      }
    } catch (err) {
      console.error('[JSONBin ERROR] No se pudieron cargar las preguntas desde la nube.', '\nURL:', `https://api.jsonbin.io/v3/b/${BIN_ID}/latest`, '\nDetalle:', err);
      this.loadQuestionsFromLocalStorage();
      this.showCloudToast('Sin conexión — usando datos locales', 'error');
    }

    this.renderAdminQuestions();
    this.showView('setup-view');
  }

  /** Fallback: carga desde localStorage */
  loadQuestionsFromLocalStorage() {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        this.questions = this.normalizeQuestionsArray(JSON.parse(stored));
      } else {
        const defaults = typeof DEFAULT_QUESTIONS !== 'undefined' ? DEFAULT_QUESTIONS : [];
        this.questions = this.normalizeQuestionsArray(defaults);
        this.saveQuestionsToLocalStorage();
      }
    } catch (e) {
      console.error('Error cargando de localStorage', e);
      this.questions = [];
    }
  }

  normalizeQuestionsArray(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map((q, idx) => ({
      id: q.id || idx + 1,
      question: this.cleanQuestionText(q.question),
      options: (q.options || []).filter(o => String(o).trim().length > 0).map(opt => this.cleanOptionText(opt)),
      correctAnswer: typeof q.correctAnswer === 'number' ? q.correctAnswer : 0
    }));
  }

  /** Guarda en localStorage (caché local rápido) */
  saveQuestionsToLocalStorage() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.questions));
    } catch (e) {
      console.error('Error guardando en LocalStorage', e);
    }
  }

  /** Guarda en JSONBin.io (nube) y también en localStorage */
  async saveQuestionsToCloud() {
    // Siempre guardar localmente primero (instantáneo)
    this.saveQuestionsToLocalStorage();

    this.showCloudToast('Guardando en la nube...', 'loading');
    try {
      const res = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Master-Key': API_KEY
        },
        body: JSON.stringify(this.questions)
      });

      if (!res.ok) throw new Error(`HTTP ${res.status} al guardar en JSONBin`);

      console.log('[JSONBin OK] Preguntas guardadas en la nube. Total:', this.questions.length);
      this.showCloudToast('Guardado en la nube ✔', 'success');
    } catch (err) {
      console.error('[JSONBin ERROR] No se pudieron guardar las preguntas en la nube.', '\nURL:', `https://api.jsonbin.io/v3/b/${BIN_ID}`, '\nDetalle:', err);
      this.showCloudToast('Error al guardar en la nube', 'error');
    }
  }

  clearAllQuestions() {
    if (confirm('¿Estás seguro de borrar TODAS las preguntas cargadas? Esta acción vaciará el banco de preguntas.')) {
      this.questions = [];
      this.saveQuestionsToCloud();
      this.renderAdminQuestions();
    }
  }

  /* ========================================================================
     PARSER Y ADICIÓN DE PREGUNTAS (ADMINISTRADOR)
     ======================================================================== */
  parsePastedText() {
    const rawText = document.getElementById('paste-text-input').value;
    const previewBox = document.getElementById('parse-preview-box');
    const previewTitle = document.getElementById('preview-question-title');
    const previewList = document.getElementById('preview-options-list');

    if (!rawText.trim()) {
      previewBox.style.display = 'none';
      return;
    }

    const parsed = this.extractQuestionAndOptions(rawText);

    if (parsed.questionText && parsed.options.length > 0) {
      previewTitle.textContent = parsed.questionText;
      previewList.innerHTML = '';
      
      const letters = ['a', 'b', 'c', 'd', 'e'];
      parsed.options.forEach((opt, idx) => {
        const item = document.createElement('div');
        item.style.fontSize = '0.88rem';
        item.style.color = 'var(--text-dark)';
        item.innerHTML = `<strong>${letters[idx]}.</strong> ${this.escapeHTML(opt)}`;
        previewList.appendChild(item);
      });

      previewBox.style.display = 'block';
    } else {
      previewBox.style.display = 'none';
    }
  }

  extractQuestionAndOptions(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) return { questionText: '', options: [] };

    let questionLines = [];
    let rawOptions = [];

    const optionRegex = /^([0-9]+[\.\)\-]\s*)?([a-eA-E])[\.\)\-]\s*(.+)/;

    lines.forEach(line => {
      const match = line.match(optionRegex);
      if (match) {
        rawOptions.push(match[3].trim());
      } else if (rawOptions.length === 0) {
        questionLines.push(line);
      }
    });

    if (rawOptions.length === 0 && lines.length > 1) {
      questionLines = [lines[0]];
      rawOptions = lines.slice(1);
    }

    const cleanQuestion = this.cleanQuestionText(questionLines.join(' '));
    const cleanOpts = rawOptions.map(opt => this.cleanOptionText(opt));

    return {
      questionText: cleanQuestion,
      options: cleanOpts
    };
  }

  addPastedQuestion() {
    const rawText = document.getElementById('paste-text-input').value;
    if (!rawText.trim()) {
      alert('Por favor pega el texto de la pregunta primero.');
      return;
    }

    const parsed = this.extractQuestionAndOptions(rawText);

    if (!parsed.questionText || parsed.options.length < 2) {
      alert('Asegúrate de escribir la pregunta y al menos 2 opciones de respuesta (ejemplo: a. Opción A  b. Opción B).');
      return;
    }

    const selectedRadio = document.querySelector('input[name="correct-select"]:checked');
    const correctAnswer = parseInt(selectedRadio ? selectedRadio.value : 0, 10);

    if (correctAnswer >= parsed.options.length) {
      alert(`Marcaste la opción (${['a','b','c','d'][correctAnswer]}) como correcta, pero la pregunta solo tiene ${parsed.options.length} opciones.`);
      return;
    }

    const newId = this.questions.length > 0 ? Math.max(...this.questions.map(q => q.id)) + 1 : 1;

    const newQuestion = {
      id: newId,
      question: parsed.questionText,
      options: parsed.options,
      correctAnswer: correctAnswer
    };

    this.questions.push(newQuestion);
    this.saveQuestionsToCloud();

    document.getElementById('paste-text-input').value = '';
    document.getElementById('parse-preview-box').style.display = 'none';

    this.renderAdminQuestions();
    alert(`¡Pregunta agregada exitosamente! Total de preguntas: ${this.questions.length}`);
  }

  /* ========================================================================
     EDICIÓN DE PREGUNTAS (MODO ADMINISTRADOR)
     ======================================================================== */
  openEditModal(id) {
    const q = this.questions.find(item => item.id === id);
    if (!q) return;

    document.getElementById('edit-q-id').value = q.id;
    document.getElementById('edit-q-text').value = q.question;

    document.getElementById('edit-opt-0').value = q.options[0] || '';
    document.getElementById('edit-opt-1').value = q.options[1] || '';
    document.getElementById('edit-opt-2').value = q.options[2] || '';
    document.getElementById('edit-opt-3').value = q.options[3] || '';

    const radioToSelect = document.getElementById(`edit-radio-${q.correctAnswer}`);
    if (radioToSelect) {
      radioToSelect.checked = true;
    } else {
      document.getElementById('edit-radio-0').checked = true;
    }

    document.getElementById('edit-modal-title').textContent = `✏️ Editar Pregunta #${q.id}`;
    document.getElementById('edit-modal').classList.add('active-modal');
  }

  closeEditModal() {
    document.getElementById('edit-modal').classList.remove('active-modal');
  }

  saveEditedQuestion(event) {
    event.preventDefault();

    const id = parseInt(document.getElementById('edit-q-id').value, 10);
    const questionText = this.cleanQuestionText(document.getElementById('edit-q-text').value);

    const opt0 = this.cleanOptionText(document.getElementById('edit-opt-0').value);
    const opt1 = this.cleanOptionText(document.getElementById('edit-opt-1').value);
    const opt2 = this.cleanOptionText(document.getElementById('edit-opt-2').value);
    const opt3 = this.cleanOptionText(document.getElementById('edit-opt-3').value);

    const rawOpts = [opt0, opt1, opt2, opt3].filter(o => o.length > 0);

    if (!questionText || rawOpts.length < 2) {
      alert('La pregunta debe tener enunciado y al menos 2 opciones de respuesta.');
      return;
    }

    const selectedRadio = document.querySelector('input[name="edit-correct-radio"]:checked');
    const correctAnswer = parseInt(selectedRadio ? selectedRadio.value : 0, 10);

    if (correctAnswer >= rawOpts.length) {
      alert('La opción seleccionada como correcta no tiene texto ingresado.');
      return;
    }

    const qIndex = this.questions.findIndex(q => q.id === id);
    if (qIndex !== -1) {
      this.questions[qIndex] = {
        ...this.questions[qIndex],
        question: questionText,
        options: rawOpts,
        correctAnswer: correctAnswer
      };

      this.saveQuestionsToCloud();
      this.renderAdminQuestions();
      this.closeEditModal();
      alert('¡Pregunta actualizada con éxito!');
    }
  }

  /* ========================================================================
     NAVEGACIÓN DE PANTALLAS Y ROLES
     ======================================================================== */
  showView(viewId) {
    document.querySelectorAll('.view-section').forEach(view => {
      view.classList.remove('active-view');
    });
    const target = document.getElementById(viewId);
    if (target) {
      target.classList.add('active-view');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  switchRole(role) {
    this.currentRole = role;
    const btnStudent = document.getElementById('role-student-btn');
    const btnAdmin = document.getElementById('role-admin-btn');

    if (role === 'student') {
      btnStudent.classList.add('active');
      btnAdmin.classList.remove('active');
      if (this.examState.isFinished) {
        this.showView('results-view');
      } else if (this.examState.questions.length > 0 && !this.examState.isFinished) {
        this.showView('simulator-view');
      } else {
        this.showView('setup-view');
      }
    } else {
      btnAdmin.classList.add('active');
      btnStudent.classList.remove('active');
      if (this.isAdminLoggedIn) {
        this.renderAdminQuestions();
        this.showView('admin-view');
      } else {
        this.showView('admin-login-view');
      }
    }
  }

  handleAdminLogin() {
    const usernameInput = document.getElementById('admin-login-username');
    const passwordInput = document.getElementById('admin-login-password');
    const errorEl = document.getElementById('admin-login-error');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (username === 'Nixon' && password === '123') {
      this.isAdminLoggedIn = true;
      errorEl.style.display = 'none';
      usernameInput.value = '';
      passwordInput.value = '';
      this.renderAdminQuestions();
      this.showView('admin-view');
    } else {
      errorEl.style.display = 'block';
    }
  }

  selectMode(mode) {
    this.currentMode = mode; // 'exam' | 'study' | 'random20'
    const examCard = document.getElementById('mode-card-exam');
    const randomCard = document.getElementById('mode-card-random');
    const studyCard = document.getElementById('mode-card-study');
    if (examCard) examCard.classList.toggle('selected', mode === 'exam');
    if (randomCard) randomCard.classList.toggle('selected', mode === 'random20');
    if (studyCard) studyCard.classList.toggle('selected', mode === 'study');
  }

  /* ========================================================================
     INICIO DE SIMULACIÓN - TODAS LAS PREGUNTAS EN UNA SOLA VISTA
     ======================================================================== */
  startSimulation() {
    if (this.questions.length === 0) {
      alert('El banco de preguntas está vacío. Ve al Modo Administrador para agregar preguntas primero.');
      this.switchRole('admin');
      return;
    }

    if (this.currentMode === 'study') {
      this.startStudyMode();
      return;
    }

    let examQuestions;

    if (this.currentMode === 'random20') {
      // Seleccionar 20 preguntas aleatorias (o todas si hay menos de 20)
      const shuffled = [...this.questions].sort(() => Math.random() - 0.5);
      examQuestions = shuffled.slice(0, 20);
    } else {
      // Modo examen real: todas las preguntas
      examQuestions = [...this.questions];
    }

    this.examState = {
      questions: examQuestions,
      answers: {},
      timerInterval: null,
      elapsedSeconds: 0,
      isFinished: false
    };

    document.getElementById('total-q-num').textContent = examQuestions.length;

    this.renderTopQuestionSelector();
    this.renderSingleViewQuestions();
    this.startTimer();
    this.showView('simulator-view');
  }

  /* ========================================================================
     RENDERIZADO DEL SELECTOR SUPERIOR EN MODO EXAMEN
     ======================================================================== */
  renderTopQuestionSelector() {
    const container = document.getElementById('top-question-selector-grid');
    container.innerHTML = '';

    const { questions, answers } = this.examState;

    questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.className = 'q-select-btn';
      btn.textContent = idx + 1;
      btn.id = `top-q-btn-${q.id}`;

      if (answers[q.id] !== undefined) {
        btn.classList.add('answered');
      }

      btn.onclick = () => this.scrollToElement(`q-card-${q.id}`, `top-q-btn-${q.id}`);
      container.appendChild(btn);
    });

    this.updateAnsweredCountBadge();
  }

  updateAnsweredCountBadge() {
    const count = Object.keys(this.examState.answers).length;
    document.getElementById('answered-count-badge').textContent = count;
  }

  scrollToElement(elementId, btnId = null) {
    const cardElement = document.getElementById(elementId);
    if (cardElement) {
      cardElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    if (btnId) {
      const btn = document.getElementById(btnId);
      if (btn) {
        btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
      }
    }
  }

  /* ========================================================================
     RENDERIZADO DE TODAS LAS PREGUNTAS DEL EXAMEN EN UNA SOLA VISTA
     ======================================================================== */
  renderSingleViewQuestions() {
    const container = document.getElementById('single-view-questions-container');
    container.innerHTML = '';

    const { questions, answers } = this.examState;
    const letters = ['a', 'b', 'c', 'd', 'e'];

    questions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'card-slate single-view-q-card';
      card.id = `q-card-${q.id}`;

      const userSelected = answers[q.id];

      let optionsHTML = '';
      q.options.forEach((optText, oIdx) => {
        const cleanOpt = this.cleanOptionText(optText);
        const isSelected = userSelected === oIdx;

        optionsHTML += `
          <button type="button" class="option-btn ${isSelected ? 'selected' : ''}" onclick="app.selectOptionInSingleView(${q.id}, ${oIdx})">
            <span class="option-prefix">${letters[oIdx]}.</span>
            <span class="option-text">${this.escapeHTML(cleanOpt)}</span>
          </button>
        `;
      });

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <span class="badge-tag badge-blue" style="font-size: 0.82rem;">Pregunta #${idx + 1} de ${questions.length}</span>
        </div>
        <h3 class="question-text">${idx + 1}. ${this.escapeHTML(q.question)}</h3>
        <div class="options-list">${optionsHTML}</div>
      `;

      container.appendChild(card);
    });
  }

  selectOptionInSingleView(questionId, optionIndex) {
    if (this.examState.isFinished) return;

    this.examState.answers[questionId] = optionIndex;

    const topBtn = document.getElementById(`top-q-btn-${questionId}`);
    if (topBtn) topBtn.classList.add('answered');

    const card = document.getElementById(`q-card-${questionId}`);
    if (card) {
      const buttons = card.querySelectorAll('.option-btn');
      buttons.forEach((btn, idx) => {
        btn.classList.toggle('selected', idx === optionIndex);
      });
    }

    this.updateAnsweredCountBadge();
  }

  /* ========================================================================
     MODO CUESTIONARIO DE ESTUDIO - TODAS LAS PREGUNTAS EN UNA SOLA VISTA
     ======================================================================== */
  startStudyMode() {
    this.renderTopStudySelector();
    this.renderAllStudyCards();
    this.showView('study-view');
  }

  renderTopStudySelector() {
    const container = document.getElementById('top-study-selector-grid');
    container.innerHTML = '';

    const totalCountEl = document.getElementById('study-total-count');
    if (totalCountEl) totalCountEl.textContent = this.questions.length;

    this.questions.forEach((q, idx) => {
      const btn = document.createElement('button');
      btn.className = 'q-select-btn';
      btn.textContent = idx + 1;
      btn.id = `top-study-btn-${q.id}`;
      btn.onclick = () => this.scrollToElement(`study-card-${q.id}`, `top-study-btn-${q.id}`);
      container.appendChild(btn);
    });
  }

  renderAllStudyCards() {
    const container = document.getElementById('study-cards-container');
    container.innerHTML = '';

    const letters = ['a', 'b', 'c', 'd', 'e'];

    this.questions.forEach((q, idx) => {
      const card = document.createElement('div');
      card.className = 'card-slate single-view-q-card';
      card.id = `study-card-${q.id}`;
      card.style.borderLeftColor = 'var(--emerald-green)';

      let optionsHTML = '';
      q.options.forEach((optText, oIdx) => {
        const cleanOpt = this.cleanOptionText(optText);
        const isCorrect = oIdx === q.correctAnswer;

        optionsHTML += `
          <div class="review-option-item ${isCorrect ? 'actual-correct' : ''}" style="margin-bottom: 8px;">
            <strong>${letters[oIdx]}.</strong> ${isCorrect ? '✔️ ' : ''}${this.escapeHTML(cleanOpt)} ${isCorrect ? '<strong>(Correcta)</strong>' : ''}
          </div>
        `;
      });

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span class="badge-tag badge-green">Pregunta #${idx + 1} de ${this.questions.length}</span>
          <span style="font-weight: 700; color: var(--emerald-green); font-size: 0.8rem;">Respuesta: (${letters[q.correctAnswer]})</span>
        </div>
        <h3 class="question-text" style="margin-bottom: 16px;">${idx + 1}. ${this.escapeHTML(q.question)}</h3>
        <div>${optionsHTML}</div>
      `;

      container.appendChild(card);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  startTimer() {
    if (this.examState.timerInterval) {
      clearInterval(this.examState.timerInterval);
    }
    this.examState.elapsedSeconds = 0;
    this.updateTimerDisplay();

    this.examState.timerInterval = setInterval(() => {
      this.examState.elapsedSeconds++;
      this.updateTimerDisplay();
    }, 1000);
  }

  stopTimer() {
    if (this.examState.timerInterval) {
      clearInterval(this.examState.timerInterval);
      this.examState.timerInterval = null;
    }
  }

  updateTimerDisplay() {
    const mins = Math.floor(this.examState.elapsedSeconds / 60).toString().padStart(2, '0');
    const secs = (this.examState.elapsedSeconds % 60).toString().padStart(2, '0');
    document.getElementById('timer-display').textContent = `${mins}:${secs}`;
  }

  /* ========================================================================
     FINALIZAR EXAMEN Y VER RESULTADOS
     ======================================================================== */
  confirmFinishExam() {
    const unansweredCount = this.examState.questions.length - Object.keys(this.examState.answers).length;
    let msg = '¿Deseas finalizar el examen ahora?';
    if (unansweredCount > 0) {
      msg = `Tienes ${unansweredCount} pregunta(s) sin responder de las ${this.examState.questions.length}. ¿Deseas finalizar de todos modos?`;
    }

    if (confirm(msg)) {
      this.finishExam();
    }
  }

  finishExam() {
    this.stopTimer();
    this.examState.isFinished = true;

    const total = this.examState.questions.length;
    let correctCount = 0;
    let incorrectCount = 0;
    let unansweredCount = 0;

    this.examState.questions.forEach(q => {
      const ans = this.examState.answers[q.id];
      if (ans === undefined) {
        unansweredCount++;
      } else if (ans === q.correctAnswer) {
        correctCount++;
      } else {
        incorrectCount++;
      }
    });

    const percentage = total > 0 ? Math.round((correctCount / total) * 100) : 0;

    document.getElementById('result-score-display').textContent = `${correctCount} / ${total}`;
    document.getElementById('result-score-subtitle').textContent = `Obtuviste un ${percentage}% de aciertos en la prueba.`;

    document.getElementById('metric-correct').textContent = correctCount;
    document.getElementById('metric-incorrect').textContent = incorrectCount;
    document.getElementById('metric-unanswered').textContent = unansweredCount;

    const mins = Math.floor(this.examState.elapsedSeconds / 60).toString().padStart(2, '0');
    const secs = (this.examState.elapsedSeconds % 60).toString().padStart(2, '0');
    document.getElementById('metric-time').textContent = `${mins}:${secs}`;

    document.getElementById('count-all').textContent = total;
    document.getElementById('count-incorrect').textContent = incorrectCount;
    document.getElementById('count-correct').textContent = correctCount;
    document.getElementById('count-unanswered').textContent = unansweredCount;

    this.setReviewFilter('all');
    this.showView('results-view');
  }

  /* ========================================================================
     REVISIÓN DE PREGUNTAS Y FILTROS
     ======================================================================== */
  setReviewFilter(filter) {
    this.reviewFilter = filter;
    
    document.querySelectorAll('.review-tab').forEach(tab => tab.classList.remove('active'));
    document.getElementById(`tab-${filter}`).classList.add('active');

    this.renderReviewList();
  }

  renderReviewList() {
    const container = document.getElementById('review-list-container');
    container.innerHTML = '';

    const { questions, answers } = this.examState;
    const letters = ['a', 'b', 'c', 'd', 'e'];

    const filtered = questions.filter(q => {
      const userAns = answers[q.id];
      if (this.reviewFilter === 'correct') return userAns === q.correctAnswer;
      if (this.reviewFilter === 'incorrect') return userAns !== undefined && userAns !== q.correctAnswer;
      if (this.reviewFilter === 'unanswered') return userAns === undefined;
      return true;
    });

    if (filtered.length === 0) {
      container.innerHTML = `<div style="text-align: center; padding: 24px; color: var(--text-muted);">No hay preguntas en esta categoría de filtro.</div>`;
      return;
    }

    filtered.forEach((q, idx) => {
      const userAns = answers[q.id];
      const isCorrect = userAns === q.correctAnswer;
      const isUnanswered = userAns === undefined;

      const card = document.createElement('div');
      card.className = 'review-card';

      let statusTag = '';
      if (isUnanswered) {
        statusTag = `<span class="badge-tag badge-red">⚠️ Sin responder</span>`;
      } else if (isCorrect) {
        statusTag = `<span class="badge-tag badge-green">✅ Bien Hecha</span>`;
      } else {
        statusTag = `<span class="badge-tag badge-red">❌ Mal Hecha</span>`;
      }

      let optionsHTML = '';
      q.options.forEach((opt, oIdx) => {
        const cleanOpt = this.cleanOptionText(opt);
        let optClass = 'review-option-item';
        let icon = '';

        if (oIdx === q.correctAnswer) {
          optClass += ' actual-correct';
          icon = '✔️ ';
        } else if (userAns === oIdx && !isCorrect) {
          optClass += ' user-wrong';
          icon = '❌ ';
        }

        optionsHTML += `
          <div class="${optClass}">
            <strong>${letters[oIdx]}.</strong> ${icon}${this.escapeHTML(cleanOpt)}
          </div>
        `;
      });

      card.innerHTML = `
        <div class="review-card-header">
          <span style="font-weight: 700; color: var(--text-muted); font-size: 0.82rem;">Pregunta #${q.id}</span>
          ${statusTag}
        </div>
        <div class="review-card-title">${idx + 1}. ${this.escapeHTML(q.question)}</div>
        <div style="margin-bottom: 8px;">${optionsHTML}</div>
      `;

      container.appendChild(card);
    });
  }

  /* ========================================================================
     PANEL DE ADMINISTRACIÓN (TABLA Y ACCIONES)
     ======================================================================== */
  renderAdminQuestions() {
    const tbody = document.getElementById('admin-questions-tbody');
    const searchInput = document.getElementById('admin-search');
    const searchVal = searchInput ? searchInput.value.toLowerCase() : '';

    const filtered = this.questions.filter(q => {
      return q.question.toLowerCase().includes(searchVal) || 
             q.options.some(o => o.toLowerCase().includes(searchVal));
    });

    const totalCount = document.getElementById('admin-total-count');
    if (totalCount) totalCount.textContent = this.questions.length;

    if (!tbody) return;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 24px;">No hay preguntas cargadas en el banco. ¡Agrega tus preguntas arriba!</td></tr>`;
      return;
    }

    const letters = ['a', 'b', 'c', 'd', 'e'];

    filtered.forEach((q, index) => {
      const tr = document.createElement('tr');

      let optionsListHTML = '<ol style="padding-left: 18px; margin-top: 4px; font-size: 0.85rem; list-style-type: lower-alpha;">';
      q.options.forEach((opt, idx) => {
        const cleanOpt = this.cleanOptionText(opt);
        const isCorr = idx === q.correctAnswer;
        optionsListHTML += `<li style="${isCorr ? 'font-weight:700; color:var(--emerald-green);' : ''}">${this.escapeHTML(cleanOpt)}${isCorr ? ' ✔️ (Correcta)' : ''}</li>`;
      });
      optionsListHTML += '</ol>';

      const cleanCorrectOptText = this.cleanOptionText(q.options[q.correctAnswer] || '');

      tr.innerHTML = `
        <td><strong>#${index + 1}</strong></td>
        <td>
          <div style="font-weight: 700; color: var(--text-dark);">${this.escapeHTML(q.question)}</div>
          ${optionsListHTML}
        </td>
        <td>
          <span class="badge-tag badge-green" style="font-size: 0.8rem;">
            (${letters[q.correctAnswer]}) ${this.escapeHTML(cleanCorrectOptText)}
          </span>
        </td>
        <td style="text-align: center; white-space: nowrap;">
          <button class="btn-emerald" style="padding: 5px 10px; font-size: 0.8rem; margin-right: 4px;" onclick="app.openEditModal(${q.id})">✏️ Editar</button>
          <button class="btn-danger" style="padding: 5px 10px; font-size: 0.8rem;" onclick="app.deleteQuestion(${q.id})">🗑️ Borrar</button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  deleteQuestion(id) {
    if (confirm('¿Deseas borrar esta pregunta del simulador?')) {
      this.questions = this.questions.filter(q => q.id !== id);
      this.saveQuestionsToCloud();
      this.renderAdminQuestions();
    }
  }

  /* ========================================================================
     HERRAMIENTAS DE RESPALDO: EXPORTAR E IMPORTAR JSON
     ======================================================================== */
  exportJSON() {
    if (this.questions.length === 0) {
      alert('No hay preguntas para exportar.');
      return;
    }

    const cleanData = this.questions.map((q, idx) => ({
      id: idx + 1,
      question: this.cleanQuestionText(q.question),
      options: q.options.map(opt => this.cleanOptionText(opt)),
      correctAnswer: q.correctAnswer
    }));

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(cleanData, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", "preguntas_examen_de_leyes.json");
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  openImportModal() {
    document.getElementById('import-json-text').value = '';
    document.getElementById('import-file-input').value = '';
    document.getElementById('import-modal').classList.add('active-modal');
  }

  closeImportModal() {
    document.getElementById('import-modal').classList.remove('active-modal');
  }

  handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('import-json-text').value = e.target.result;
    };
    reader.readAsText(file);
  }

  processImportJSON() {
    const rawText = document.getElementById('import-json-text').value.trim();
    if (!rawText) {
      alert('Por favor selecciona un archivo o pega el código JSON.');
      return;
    }

    try {
      const parsed = JSON.parse(rawText);
      if (!Array.isArray(parsed)) {
        throw new Error('El archivo debe ser un arreglo de preguntas.');
      }

      this.questions = this.normalizeQuestionsArray(parsed);
      this.saveQuestionsToCloud();
      this.renderAdminQuestions();
      this.closeImportModal();
      alert(`¡Se cargaron e importaron exitosamente ${this.questions.length} preguntas!`);
    } catch (err) {
      alert(`Error al cargar JSON: ${err.message}`);
    }
  }

  /* ========================================================================
     UTILIDAD DE ESCAPE DE CARACTERES HTML
     ======================================================================== */
  escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
      }[m];
    });
  }
}

// Inicializar la aplicación al cargar la ventana
let app;
window.addEventListener('DOMContentLoaded', () => {
  app = new ANTSimulatorApp();
});
