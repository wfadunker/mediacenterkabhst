
/* =========================================================
 * MEDIA CENTER HST - ACCESSIBILITY CONTROLLER
 * Versi: 3.0
 *
 * - Tanpa dependensi tambahan
 * - Tidak mengubah database atau server.js
 * - Menggunakan selector data-a11y yang sudah ada
 * - Log konsol ringkas dengan prefix [MC-A11Y]
 * ======================================================= */

(() => {
  'use strict';

  const PREFIX = '[MC-A11Y]';
  const DEBUG = false;
  const STORAGE_KEY = 'mc-hst-accessibility-v2';

  const logger = {
    info: (...args) => console.info(PREFIX, ...args),
    warn: (...args) => console.warn(PREFIX, ...args),
    error: (...args) => console.error(PREFIX, ...args),
    debug: (...args) => {
      if (DEBUG) console.debug(PREFIX, ...args);
    }
  };

  const LIMITS = {
    scaleMin: 80,
    scaleMax: 150,
    scaleStep: 10,
    rateMin: 0.7,
    rateMax: 1.5,
    pitchMin: 0.7,
    pitchMax: 1.5,
    speechChunk: 220
  };

  const DEFAULTS = {
    mode: 'normal',
    scale: 100,
    rate: 1,
    pitch: 1,
    voiceURI: '',
    toggles: {
      readableFont: false,
      lineSpacing: false,
      letterSpacing: false,
      underlineLinks: false,
      highlightLinks: false,
      hideImages: false,
      grayscale: false,
      largeCursor: false,
      readingGuide: false,
      reduceMotion: false,
      focusMode: false
    }
  };

  const CLASS_NAMES = {
    readableFont: 'mc-a11y-readable-font',
    lineSpacing: 'mc-a11y-line-spacing',
    letterSpacing: 'mc-a11y-letter-spacing',
    underlineLinks: 'mc-a11y-underline-links',
    highlightLinks: 'mc-a11y-highlight-links',
    hideImages: 'mc-a11y-hide-images',
    grayscale: 'mc-a11y-grayscale',
    largeCursor: 'mc-a11y-large-cursor',
    readingGuide: 'mc-a11y-reading-guide',
    reduceMotion: 'mc-a11y-reduce-motion',
    focusMode: 'mc-a11y-focus-mode'
  };

  /*
   * Mode Fokus hanya mengaktifkan focusMode.
   * Reading Guide dan Reduce Motion tetap terpisah.
   */
  const PRESETS = {
    vision: {
      mode: 'highContrast',
      scale: 130,
      toggles: [
        'readableFont',
        'underlineLinks',
        'largeCursor',
        'reduceMotion'
      ]
    },

    reading: {
      mode: 'normal',
      scale: 110,
      toggles: [
        'readableFont',
        'lineSpacing',
        'letterSpacing',
        'underlineLinks'
      ]
    },

    focus: {
      mode: 'normal',
      scale: 110,
      toggles: ['focusMode']
    }
  };

  const clamp = (value, min, max) =>
    Math.min(max, Math.max(min, value));

  const cloneDefaults = () => ({
    ...DEFAULTS,
    toggles: { ...DEFAULTS.toggles }
  });

  const init = () => {
    const root = document.querySelector('[data-mc-a11y]');

    if (!root) {
      logger.debug('Widget tidak ditemukan. Inisialisasi dilewati.');
      return;
    }

    if (root.dataset.initialized === 'true') {
      logger.debug('Widget sudah diinisialisasi.');
      return;
    }

    const $ = (selector) => root.querySelector(selector);
    const $$ = (selector) =>
      Array.from(root.querySelectorAll(selector));

    const panel = $('#mc-a11y-panel');
    const launcher = $('[data-a11y-open]');
    const closeButton = $('[data-a11y-close]');

    if (!panel || !launcher) {
      logger.warn(
        'Panel atau tombol pembuka tidak ditemukan.'
      );
      return;
    }

    root.dataset.initialized = 'true';

    const html = document.documentElement;

    /* =====================================================
       ELEMENT REFERENCES
    ===================================================== */

    const speechStatus = $('[data-a11y-speech-status]');
    const dictationStatus = $('[data-a11y-dictation-status]');

    const dictationInput = $('[data-a11y-dictation]');
    const dictateButton = $('[data-a11y-action="dictate"]');

    const voiceSelect = $('[data-a11y-voice]');

    const rateInput = $('[data-a11y-rate]');
    const pitchInput = $('[data-a11y-pitch]');

    const rateOutput = $('[data-a11y-rate-value]');
    const pitchOutput = $('[data-a11y-pitch-value]');

    const scaleOutput = $('[data-a11y-scale-label]');

    const guide = $('[data-a11y-guide]');

    /* =====================================================
       BROWSER SUPPORT
    ===================================================== */

    const synth = 'speechSynthesis' in window
      ? window.speechSynthesis
      : null;

    const Utterance =
      window.SpeechSynthesisUtterance || null;

    const Recognition =
      window.SpeechRecognition ||
      window.webkitSpeechRecognition ||
      null;

    const speechSupported = Boolean(synth && Utterance);
    const dictationSupported = Boolean(Recognition);

    /* =====================================================
       APPLICATION STATE
    ===================================================== */

    let settings = cloneDefaults();

    let activePreset = null;
    let panelOpen = false;

    let voices = [];

    let speechQueue = [];
    let speechIndex = 0;
    let speechToken = 0;

    let speechPlaying = false;
    let speechPaused = false;

    let recognition = null;
    let dictationActive = false;

    let dictationBase = '';
    let dictationFinal = '';
    let dictationError = '';

    /* =====================================================
       STATUS MANAGEMENT
    ===================================================== */

    const announce = (message) => {
      if (speechStatus) {
        speechStatus.textContent = message;
      }
    };

    const announceDictation = (message) => {
      if (dictationStatus) {
        dictationStatus.textContent = message;
      }
    };

    /* =====================================================
       STORAGE MANAGEMENT
    ===================================================== */

    const loadSettings = () => {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);

        if (!raw) return;

        const saved = JSON.parse(raw);

        if (
          !saved ||
          typeof saved !== 'object' ||
          Array.isArray(saved)
        ) {
          logger.warn('Format pengaturan tidak valid.');
          return;
        }

        if (
          ['normal', 'highContrast', 'darkMode']
            .includes(saved.mode)
        ) {
          settings.mode = saved.mode;
        }

        const scale = Number(saved.scale);

        if (Number.isFinite(scale)) {
          settings.scale = clamp(
            scale,
            LIMITS.scaleMin,
            LIMITS.scaleMax
          );
        }

        const rate = Number(saved.rate);

        if (Number.isFinite(rate)) {
          settings.rate = clamp(
            rate,
            LIMITS.rateMin,
            LIMITS.rateMax
          );
        }

        const pitch = Number(saved.pitch);

        if (Number.isFinite(pitch)) {
          settings.pitch = clamp(
            pitch,
            LIMITS.pitchMin,
            LIMITS.pitchMax
          );
        }

        if (typeof saved.voiceURI === 'string') {
          settings.voiceURI = saved.voiceURI;
        }

        if (
          saved.toggles &&
          typeof saved.toggles === 'object' &&
          !Array.isArray(saved.toggles)
        ) {
          Object.keys(settings.toggles).forEach((key) => {
            if (typeof saved.toggles[key] === 'boolean') {
              settings.toggles[key] = saved.toggles[key];
            }
          });
        }

        logger.debug('Pengaturan berhasil dimuat.');

      } catch (error) {
        logger.warn(
          'Pengaturan lokal gagal dibaca. Menggunakan default.',
          error
        );
      }
    };

    const saveSettings = () => {
      try {
        window.localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(settings)
        );

      } catch (error) {
        logger.warn(
          'Pengaturan tidak dapat disimpan di browser.',
          error
        );
      }
    };

    /* =====================================================
       BUTTON AND DISPLAY UPDATES
    ===================================================== */

    const updateSpeechButtons = () => {
      const pauseButton =
        $('[data-a11y-action="pause"]');

      const resumeButton =
        $('[data-a11y-action="resume"]');

      const stopButton =
        $('[data-a11y-action="stop"]');

      if (pauseButton) {
        pauseButton.disabled =
          !speechPlaying || speechPaused;
      }

      if (resumeButton) {
        resumeButton.disabled =
          !speechPlaying || !speechPaused;
      }

      if (stopButton) {
        stopButton.disabled = !speechPlaying;
      }
    };

    const updateDictationButton = () => {
      if (!dictateButton) return;

      dictateButton.textContent = dictationActive
        ? '■ Berhenti Dikte'
        : '● Mulai Dikte';

      dictateButton.setAttribute(
        'aria-pressed',
        String(dictationActive)
      );
    };

    /* =====================================================
       APPLY ACCESSIBILITY SETTINGS
    ===================================================== */

    const applySettings = () => {
      html.classList.toggle(
        'mc-a11y-high-contrast',
        settings.mode === 'highContrast'
      );

      html.classList.toggle(
        'mc-a11y-dark-mode',
        settings.mode === 'darkMode'
      );

      html.style.setProperty(
        '--mc-a11y-scale',
        String(settings.scale / 100)
      );

      Object.entries(CLASS_NAMES).forEach(
        ([key, className]) => {
          html.classList.toggle(
            className,
            Boolean(settings.toggles[key])
          );
        }
      );

      $$('[data-a11y-toggle]').forEach((button) => {
        const key = button.dataset.a11yToggle;

        button.setAttribute(
          'aria-pressed',
          String(Boolean(settings.toggles[key]))
        );
      });

      $$('[data-a11y-mode]').forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.a11yMode === settings.mode)
        );
      });

      $$('[data-a11y-preset]').forEach((button) => {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.a11yPreset === activePreset)
        );
      });

      if (scaleOutput) {
        scaleOutput.textContent = `${settings.scale}%`;
      }

      if (rateInput) {
        rateInput.value = String(settings.rate);
      }

      if (pitchInput) {
        pitchInput.value = String(settings.pitch);
      }

      if (rateOutput) {
        rateOutput.textContent =
          `${settings.rate.toFixed(1).replace('.', ',')}×`;
      }

      if (pitchOutput) {
        pitchOutput.textContent =
          settings.pitch.toFixed(1).replace('.', ',');
      }

      if (voiceSelect) {
        voiceSelect.value = settings.voiceURI;
      }
    };

    /* =====================================================
       PANEL MANAGEMENT
    ===================================================== */

    const setPanelOpen = (open, returnFocus = true) => {
      panelOpen = Boolean(open);

      panel.hidden = !panelOpen;

      panel.setAttribute(
        'aria-hidden',
        String(!panelOpen)
      );

      launcher.setAttribute(
        'aria-expanded',
        String(panelOpen)
      );

      if (panelOpen) {
        window.requestAnimationFrame(() => {
          closeButton?.focus();
        });

      } else if (returnFocus) {
        launcher.focus();
      }
    };

    const closePanel = (returnFocus = true) => {
      setPanelOpen(false, returnFocus);
    };

    setPanelOpen(false, false);

    launcher.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      setPanelOpen(!panelOpen);
    });

    closeButton?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();

      closePanel();
    });

    document.addEventListener('pointerdown', (event) => {
      if (panelOpen && !root.contains(event.target)) {
        closePanel(false);
      }
    });

    /* =====================================================
       KEYBOARD NAVIGATION
    ===================================================== */

    document.addEventListener('keydown', (event) => {

      // Escape untuk menutup panel.
      if (event.key === 'Escape' && panelOpen) {
        event.preventDefault();
        closePanel();
        return;
      }

      // Shortcut Alt + Shift + A.
      if (
        event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 'a'
      ) {
        event.preventDefault();
        setPanelOpen(!panelOpen);
        return;
      }

      // Focus trap.
      if (event.key !== 'Tab' || !panelOpen) return;

      const focusable = Array.from(
        panel.querySelectorAll(
          'button:not(:disabled), ' +
          'input:not(:disabled), ' +
          'select:not(:disabled), ' +
          'textarea:not(:disabled), ' +
          'a[href], ' +
          '[tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => {
        return (
          !element.hidden &&
          element.getClientRects().length > 0
        );
      });

      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (
        event.shiftKey &&
        document.activeElement === first
      ) {
        event.preventDefault();
        last.focus();

      } else if (
        !event.shiftKey &&
        document.activeElement === last
      ) {
        event.preventDefault();
        first.focus();
      }
    });

    /* =====================================================
       ACCESSIBILITY PRESETS
    ===================================================== */

    const applyPreset = (name) => {
      const preset = PRESETS[name];

      if (!preset) {
        logger.warn('Preset tidak dikenal:', name);
        return;
      }

      settings.mode = preset.mode;
      settings.scale = preset.scale;

      Object.keys(settings.toggles).forEach((key) => {
        settings.toggles[key] = false;
      });

      preset.toggles.forEach((key) => {
        if (
          Object.prototype.hasOwnProperty.call(
            settings.toggles,
            key
          )
        ) {
          settings.toggles[key] = true;
        }
      });

      activePreset = name;

      applySettings();
      saveSettings();

      logger.debug('Preset diterapkan:', name);
    };

    /* =====================================================
       FONT SIZE MANAGEMENT
    ===================================================== */

    const changeScale = (action) => {

      if (action === 'increase') {
        settings.scale = clamp(
          settings.scale + LIMITS.scaleStep,
          LIMITS.scaleMin,
          LIMITS.scaleMax
        );

      } else if (action === 'decrease') {
        settings.scale = clamp(
          settings.scale - LIMITS.scaleStep,
          LIMITS.scaleMin,
          LIMITS.scaleMax
        );

      } else if (action === 'reset') {
        settings.scale = DEFAULTS.scale;

      } else {
        return;
      }

      activePreset = null;

      applySettings();
      saveSettings();
    };

    /* =====================================================
       TEXT TO SPEECH - VOICE MANAGEMENT
    ===================================================== */

    const loadVoices = () => {
      if (!speechSupported || !voiceSelect) return;

      voices = synth.getVoices();

      const selectedVoice = settings.voiceURI;

      voiceSelect.replaceChildren();

      const automaticOption =
        document.createElement('option');

      automaticOption.value = '';
      automaticOption.textContent =
        'Otomatis - Bahasa Indonesia';

      voiceSelect.appendChild(automaticOption);

      voices.forEach((voice) => {
        const option = document.createElement('option');

        option.value = voice.voiceURI;

        option.textContent =
          `${voice.name} (${voice.lang})`;

        voiceSelect.appendChild(option);
      });

      settings.voiceURI = voices.some(
        (voice) => voice.voiceURI === selectedVoice
      ) ? selectedVoice : '';

      voiceSelect.value = settings.voiceURI;
    };

    if (speechSupported) {
      loadVoices();

      if (typeof synth.addEventListener === 'function') {
        synth.addEventListener('voiceschanged', loadVoices);
      } else {
        synth.onvoiceschanged = loadVoices;
      }
    }

    voiceSelect?.addEventListener('change', () => {
      settings.voiceURI = voiceSelect.value;
      saveSettings();
    });

    const getVoice = () => {
      if (!voices.length) return null;

      if (settings.voiceURI) {
        const selectedVoice = voices.find(
          (voice) => voice.voiceURI === settings.voiceURI
        );

        if (selectedVoice) return selectedVoice;
      }

      return voices.find(
        (voice) => voice.lang.toLowerCase() === 'id-id'
      ) || voices.find(
        (voice) => voice.lang.toLowerCase().startsWith('id')
      ) || null;
    };

    /* =====================================================
       PAGE TEXT EXTRACTION
    ===================================================== */

    const getPageText = () => {
      const main = document.querySelector(
        'main#konten-utama, main, [role="main"]'
      ) || document.body;

      const clone = main.cloneNode(true);

      clone.querySelectorAll(
        'script, style, noscript, nav, footer, ' +
        'button, input, select, textarea, ' +
        '[hidden], [aria-hidden="true"], ' +
        '[data-mc-a11y], .mc-a11y'
      ).forEach((element) => element.remove());

      return clone.textContent
        .replace(/\s+/g, ' ')
        .trim();
    };

    /* =====================================================
       TEXT SPLITTING
    ===================================================== */

    const splitText = (
      text,
      limit = LIMITS.speechChunk
    ) => {
      const sentences =
        text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];

      const chunks = [];
      let current = '';

      sentences.forEach((sentence) => {
        const value = sentence.trim();

        if (!value) return;

        if (value.length > limit) {
          if (current) {
            chunks.push(current);
            current = '';
          }

          let part = '';

          value.split(/\s+/).forEach((word) => {
            const next = part
              ? `${part} ${word}`
              : word;

            if (next.length > limit && part) {
              chunks.push(part);
              part = word;
            } else {
              part = next;
            }
          });

          if (part) chunks.push(part);

          return;
        }

        const next = current
          ? `${current} ${value}`
          : value;

        if (next.length > limit && current) {
          chunks.push(current);
          current = value;
        } else {
          current = next;
        }
      });

      if (current) chunks.push(current);

      return chunks;
    };

    /* =====================================================
       SPEECH CONTROL
    ===================================================== */

    const stopSpeech = () => {
      speechToken++;

      speechQueue = [];
      speechIndex = 0;

      speechPlaying = false;
      speechPaused = false;

      if (synth) {
        synth.cancel();
      }

      updateSpeechButtons();
    };

    /* =====================================================
       SPEECH QUEUE
    ===================================================== */

    const speakNext = (token) => {
      if (token !== speechToken) return;

      if (speechIndex >= speechQueue.length) {
        speechPlaying = false;
        speechPaused = false;

        announce('Pembacaan teks selesai.');

        updateSpeechButtons();
        return;
      }

      const utterance = new Utterance(
        speechQueue[speechIndex]
      );

      const voice = getVoice();

      utterance.lang = 'id-ID';

      utterance.rate = settings.rate;
      utterance.pitch = settings.pitch;

      if (voice) {
        utterance.voice = voice;
        utterance.lang = voice.lang;
      }

      utterance.onend = () => {
        if (token !== speechToken) return;

        speechIndex++;

        speakNext(token);
      };

      utterance.onerror = (event) => {
        if (token !== speechToken) return;

        if (
          !['canceled', 'interrupted'].includes(event.error)
        ) {
          logger.warn(
            'Pembacaan teks mengalami kendala:',
            event.error
          );

          announce(
            'Terjadi kesalahan saat membaca teks.'
          );
        }

        speechPlaying = false;
        speechPaused = false;

        updateSpeechButtons();
      };

      synth.speak(utterance);

      announce(
        `Membaca bagian ${speechIndex + 1} dari ${speechQueue.length}.`
      );

      updateSpeechButtons();
    };

    /* =====================================================
       START SPEECH
    ===================================================== */

    const startSpeech = (text) => {
      if (!speechSupported) {
        announce(
          'Browser tidak mendukung fitur teks ke suara.'
        );
        return;
      }

      if (!text || !text.trim()) {
        announce('Tidak ada teks yang dapat dibacakan.');
        return;
      }

      stopSpeech();

      speechQueue = splitText(text);
      speechIndex = 0;

      speechPlaying = true;
      speechPaused = false;

      speakNext(speechToken);
    };

    /* =====================================================
       SPEECH RATE
    ===================================================== */

    rateInput?.addEventListener('input', () => {
      const value = Number(rateInput.value);

      if (!Number.isFinite(value)) return;

      settings.rate = clamp(
        value,
        LIMITS.rateMin,
        LIMITS.rateMax
      );

      if (rateOutput) {
        rateOutput.textContent =
          `${settings.rate.toFixed(1).replace('.', ',')}×`;
      }

      saveSettings();
    });

    /* =====================================================
       SPEECH PITCH
    ===================================================== */

    pitchInput?.addEventListener('input', () => {
      const value = Number(pitchInput.value);

      if (!Number.isFinite(value)) return;

      settings.pitch = clamp(
        value,
        LIMITS.pitchMin,
        LIMITS.pitchMax
      );

      if (pitchOutput) {
        pitchOutput.textContent =
          settings.pitch.toFixed(1).replace('.', ',');
      }

      saveSettings();
    });

    /* =====================================================
       SPEECH RECOGNITION - DICTATION
    ===================================================== */

    const stopDictation = () => {
      if (!recognition || !dictationActive) return;

      try {
        recognition.stop();

      } catch (error) {
        logger.warn(
          'Dikte tidak dapat dihentikan dengan normal.',
          error
        );

        dictationActive = false;
        updateDictationButton();
      }
    };

    const startDictation = () => {

      if (!dictationInput) {
        announceDictation(
          'Kolom hasil dikte tidak ditemukan.'
        );
        return;
      }

      if (!dictationSupported) {
        announceDictation(
          'Browser tidak mendukung dikte suara. ' +
          'Gunakan Chrome atau Edge terbaru.'
        );
        return;
      }

      if (dictationActive) {
        stopDictation();
        return;
      }

      recognition = new Recognition();

      dictationBase = dictationInput.value.trim();
      dictationFinal = '';
      dictationError = '';

      recognition.lang = 'id-ID';
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        dictationActive = true;

        updateDictationButton();

        announceDictation(
          'Mikrofon aktif. Silakan mulai berbicara.'
        );
      };

      recognition.onresult = (event) => {
        let interim = '';

        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const transcript =
            event.results[index][0].transcript;

          if (event.results[index].isFinal) {
            dictationFinal += `${transcript} `;
          } else {
            interim += transcript;
          }
        }

        dictationInput.value = [
          dictationBase,
          dictationFinal.trim(),
          interim.trim()
        ].filter(Boolean).join(' ');
      };

      recognition.onerror = (event) => {
        const messages = {
          'not-allowed':
            'Izin mikrofon ditolak. Periksa izin browser.',

          'service-not-allowed':
            'Layanan pengenalan suara tidak diizinkan.',

          'no-speech':
            'Tidak ada suara yang terdeteksi.',

          'audio-capture':
            'Mikrofon tidak ditemukan.',

          network:
            'Koneksi jaringan bermasalah.',

          aborted:
            'Proses dikte dibatalkan.'
        };

        dictationError = messages[event.error] ||
          `Terjadi kesalahan dikte: ${event.error}`;

        logger.warn(
          'Dikte suara mengalami kendala:',
          event.error
        );

        announceDictation(dictationError);
      };

      recognition.onend = () => {
        dictationActive = false;

        updateDictationButton();

        announceDictation(
          dictationError || 'Dikte selesai.'
        );
      };

      try {
        recognition.start();

      } catch (error) {
        dictationActive = false;

        updateDictationButton();

        logger.warn(
          'Mikrofon gagal dimulai.',
          error
        );

        announceDictation(
          'Mikrofon belum dapat dimulai. ' +
          'Periksa izin dan coba kembali.'
        );
      }
    };

    /* =====================================================
       COPY DICTATION
    ===================================================== */

    const copyDictation = async () => {
      if (!dictationInput) return;

      const text = dictationInput.value.trim();

      if (!text) {
        announceDictation(
          'Belum ada teks untuk disalin.'
        );
        return;
      }

      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);

          announceDictation('Teks berhasil disalin.');
          return;
        }

        throw new Error(
          'Clipboard API tidak tersedia.'
        );

      } catch (error) {

        // Fallback untuk browser lama.
        dictationInput.focus();
        dictationInput.select();

        const copied = document.execCommand
          ? document.execCommand('copy')
          : false;

        announceDictation(
          copied
            ? 'Teks berhasil disalin.'
            : 'Tidak dapat menyalin teks. Silakan salin manual.'
        );

        if (!copied) {
          logger.debug(
            'Salin teks memerlukan tindakan manual.',
            error
          );
        }
      }
    };

    /* =====================================================
       READING GUIDE
    ===================================================== */

    document.addEventListener('pointermove', (event) => {
      if (!settings.toggles.readingGuide || !guide) {
        return;
      }

      guide.style.setProperty(
        '--mc-a11y-guide-y',
        `${event.clientY}px`
      );

    }, { passive: true });

    /* =====================================================
       RESET ALL SETTINGS
    ===================================================== */

    const resetAll = () => {
      stopSpeech();

      if (dictationActive) {
        stopDictation();
      }

      settings = cloneDefaults();
      activePreset = null;

      if (dictationInput) {
        dictationInput.value = '';
      }

      applySettings();
      saveSettings();

      announce(
        'Semua pengaturan aksesibilitas telah direset.'
      );

      announceDictation(
        'Pengaturan dikembalikan ke kondisi awal.'
      );

      logger.info(
        'Pengaturan aksesibilitas direset.'
      );
    };

    /* =====================================================
       EVENT DELEGATION
    ===================================================== */

    root.addEventListener('click', (event) => {

      const target = event.target instanceof Element
        ? event.target
        : null;

      const button = target?.closest('button');

      if (!button || !root.contains(button)) return;

      /* PRESETS */

      if (button.dataset.a11yPreset) {
        applyPreset(button.dataset.a11yPreset);
        return;
      }

      /* ACCESSIBILITY TOGGLES */

      if (button.dataset.a11yToggle) {
        const key = button.dataset.a11yToggle;

        if (
          !Object.prototype.hasOwnProperty.call(
            settings.toggles,
            key
          )
        ) {
          logger.warn('Toggle tidak dikenal:', key);
          return;
        }

        settings.toggles[key] =
          !settings.toggles[key];

        activePreset = null;

        applySettings();
        saveSettings();

        return;
      }

      /* COLOR MODES */

      if (button.dataset.a11yMode) {
        const mode = button.dataset.a11yMode;

        if (
          !['normal', 'highContrast', 'darkMode']
            .includes(mode)
        ) {
          logger.warn('Mode tampilan tidak dikenal:', mode);
          return;
        }

        settings.mode = mode;
        activePreset = null;

        applySettings();
        saveSettings();

        return;
      }

      /* FONT SIZE */

      if (button.dataset.a11yScale) {
        changeScale(button.dataset.a11yScale);
        return;
      }

      /* FEATURE ACTIONS */

      const action = button.dataset.a11yAction;

      if (!action) return;

      switch (action) {

        case 'speak':
          startSpeech(getPageText());
          break;

        case 'speak-selection': {
          const selectedText =
            window.getSelection()?.toString() || '';

          startSpeech(selectedText);
          break;
        }

        case 'pause':

          if (
            speechSupported &&
            speechPlaying &&
            !speechPaused
          ) {
            synth.pause();

            speechPaused = true;

            updateSpeechButtons();

            announce('Pembacaan dijeda.');
          }

          break;

        case 'resume':

          if (
            speechSupported &&
            speechPlaying &&
            speechPaused
          ) {
            synth.resume();

            speechPaused = false;

            updateSpeechButtons();

            announce('Pembacaan dilanjutkan.');
          }

          break;

        case 'stop':
          stopSpeech();

          announce('Pembacaan dihentikan.');
          break;

        case 'dictate':
          startDictation();
          break;

        case 'copy-dictation':
          copyDictation();
          break;

        case 'clear-dictation':

          if (dictationInput) {
            dictationInput.value = '';
          }

          announceDictation('Teks dikte dihapus.');
          break;

        case 'reset-all':
          resetAll();
          break;

        default:
          logger.debug(
            'Aksi tidak memiliki handler:',
            action
          );
      }
    });

    /* =====================================================
       INITIALIZATION
    ===================================================== */

    loadSettings();

    applySettings();

    updateSpeechButtons();

    updateDictationButton();

    if (!speechSupported) {
      announce(
        'Browser tidak mendukung fitur pembaca teks.'
      );

      logger.warn(
        'Text-to-Speech tidak didukung browser ini.'
      );

    } else {
      announce('Pembaca teks siap digunakan.');
    }

    if (!dictationSupported) {
      announceDictation(
        'Dikte suara tidak didukung browser ini.'
      );

      logger.warn(
        'Speech Recognition tidak didukung browser ini.'
      );

    } else {
      announceDictation('Mikrofon belum aktif.');
    }

    logger.info(
      'Accessibility berhasil diinisialisasi.'
    );
  };

  /* =======================================================
     SAFE INITIALIZATION
  ======================================================= */

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      init,
      { once: true }
    );

  } else {
    init();
  }

})();
