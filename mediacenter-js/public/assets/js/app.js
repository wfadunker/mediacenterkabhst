'use strict';


/* =========================================================
   MEDIA CENTER HST
   APP
========================================================= */

document.addEventListener(
    'DOMContentLoaded',
    () => {
        initWitaClock();
        initBrandClock();
        initNewsSlider();
        initPublicIntro();
        initArticleActions();
    }
);


/* =========================================================
   DATE & TIME - WITA
========================================================= */

function initWitaClock()
{
    const dateElement =
        document.getElementById('hst-date');

    const timeElement =
        document.getElementById('hst-time');


    if (!dateElement && !timeElement) {
        return;
    }


    const dateFormatter =
        new Intl.DateTimeFormat(
            'id-ID',
            {
                timeZone:
                    'Asia/Makassar',

                weekday:
                    'long',

                day:
                    '2-digit',

                month:
                    'long',

                year:
                    'numeric'
            }
        );


    const timeFormatter =
        new Intl.DateTimeFormat(
            'id-ID',
            {
                timeZone:
                    'Asia/Makassar',

                hour:
                    '2-digit',

                minute:
                    '2-digit',

                second:
                    '2-digit',

                hour12:
                    false
            }
        );


    const render = () => {

        const now =
            new Date();


        if (dateElement) {
            dateElement.textContent =
                dateFormatter.format(now);
        }


        if (timeElement) {
            timeElement.textContent =
                `${timeFormatter.format(now)} WITA`;
        }

    };


    render();

    window.setInterval(
        render,
        1000
    );
}


/* =========================================================
   NEWS SLIDER
========================================================= */

function initNewsSlider()
{
    const track =
        document.getElementById(
            'news-track'
        );

    const prev =
        document.getElementById(
            'news-prev'
        );

    const next =
        document.getElementById(
            'news-next'
        );


    if (!track || !prev || !next) {
        return;
    }


    const cards =
        track.querySelectorAll(
            '.mc-news-card'
        );


    if (!cards.length) {

        prev.hidden = true;
        next.hidden = true;

        return;

    }


    const reduceMotion =
        window.matchMedia(
            '(prefers-reduced-motion: reduce)'
        );


    let autoTimer = null;
    let updateFrame = null;


    /* ---------------------------------------------------------
       Helper
    --------------------------------------------------------- */

    const getMaxScroll = () =>
        Math.max(
            0,
            track.scrollWidth
            - track.clientWidth
        );


    const hasOverflow = () =>
        track.scrollWidth
        > track.clientWidth + 2;


    const getStep = () => {

        const card =
            track.querySelector(
                '.mc-news-card'
            );


        if (!card) {
            return 0;
        }


        const style =
            window.getComputedStyle(
                track
            );


        const gap =
            parseFloat(
                style.columnGap
                || style.gap
            )
            || 0;


        return (
            card.getBoundingClientRect()
                .width
            + gap
        );

    };


    const getBehavior = () =>
        reduceMotion.matches
            ? 'auto'
            : 'smooth';


    /* ---------------------------------------------------------
       Button state
    --------------------------------------------------------- */

    const updateControls = () => {

        const overflow =
            hasOverflow();


        prev.hidden =
            !overflow;

        next.hidden =
            !overflow;


        if (!overflow) {
            return;
        }


        const max =
            getMaxScroll();


        prev.disabled =
            track.scrollLeft <= 2;


        next.disabled =
            track.scrollLeft
            >= max - 2;

    };


    const requestControlsUpdate = () => {

        if (updateFrame) {
            return;
        }


        updateFrame =
            window.requestAnimationFrame(
                () => {

                    updateControls();

                    updateFrame = null;

                }
            );

    };


    /* ---------------------------------------------------------
       Navigation
    --------------------------------------------------------- */

    const scrollOne = direction => {

        track.scrollBy({
            left:
                getStep()
                * direction,

            behavior:
                getBehavior()
        });

    };


    const goNext = () => {

        const max =
            getMaxScroll();


        /*
         * Jika sudah sampai ujung,
         * kembali ke awal tanpa animasi panjang.
         */

        if (
            track.scrollLeft
            >= max - 3
        ) {

            track.scrollTo({
                left: 0,
                behavior: 'auto'
            });

            requestControlsUpdate();

            return;
        }


        scrollOne(1);

    };


    const goPrevious = () => {

        if (
            track.scrollLeft <= 2
        ) {
            return;
        }


        scrollOne(-1);

    };


    /* ---------------------------------------------------------
       Auto slider
    --------------------------------------------------------- */

    const stopAuto = () => {

        if (!autoTimer) {
            return;
        }


        window.clearInterval(
            autoTimer
        );


        autoTimer = null;

    };


    const startAuto = () => {

        stopAuto();


        if (
            reduceMotion.matches
            || !hasOverflow()
            || document.hidden
        ) {
            return;
        }


        autoTimer =
            window.setInterval(
                goNext,
                5000
            );

    };


    const restartAuto = () => {

        stopAuto();
        startAuto();

    };


    /* ---------------------------------------------------------
       Events
    --------------------------------------------------------- */

    prev.addEventListener(
        'click',
        () => {

            goPrevious();
            restartAuto();

        }
    );


    next.addEventListener(
        'click',
        () => {

            goNext();
            restartAuto();

        }
    );


    track.addEventListener(
        'scroll',
        requestControlsUpdate,
        {
            passive: true
        }
    );


    /*
     * Pause saat user membaca / menggeser.
     */

    track.addEventListener(
        'mouseenter',
        stopAuto
    );


    track.addEventListener(
        'mouseleave',
        startAuto
    );


    track.addEventListener(
        'touchstart',
        stopAuto,
        {
            passive: true
        }
    );


    track.addEventListener(
        'touchend',
        startAuto,
        {
            passive: true
        }
    );


    track.addEventListener(
        'focusin',
        stopAuto
    );


    track.addEventListener(
        'focusout',
        startAuto
    );


    /*
     * Stop ketika tab browser tidak aktif.
     */

    document.addEventListener(
        'visibilitychange',
        () => {

            if (document.hidden) {
                stopAuto();
            } else {
                startAuto();
            }

        }
    );


    /*
     * Responsive.
     */

    window.addEventListener(
        'resize',
        () => {

            requestControlsUpdate();
            restartAuto();

        },
        {
            passive: true
        }
    );


    /*
     * Perubahan prefers-reduced-motion.
     */

    if (
        typeof reduceMotion
            .addEventListener
        === 'function'
    ) {

        reduceMotion.addEventListener(
            'change',
            restartAuto
        );

    }


    /* ---------------------------------------------------------
       Initial state
    --------------------------------------------------------- */

    updateControls();
    startAuto();
}

/* =========================================================
   PUBLIC INTRO
   Dipindahkan dari EJS agar dapat di-cache browser.
========================================================= */

function initPublicIntro() {
'use strict';

  const intro = document.getElementById('hst-intro');
  if (!intro) return;

  // Intro hanya ada pada layout PUBLIK, tidak pernah dipasang di admin.
  // Navigasi internal / tombol Kembali tidak boleh mengulang intro.
  const base = String(intro.dataset.base || '').replace(/\/+$/, '');
  const pathname = location.pathname.replace(/\/+$/, '');
  const homepagePaths = new Set([
    base, base + '/beranda', base + '/index', base + '/index.php'
  ]);

  const VISITED_KEY = 'hst:public:visited:v1';
  let hasVisited = false;
  try {
    hasVisited = sessionStorage.getItem(VISITED_KEY) === '1';
    // Tandai kunjungan bahkan saat pertama membuka halaman Berita/Tentang.
    sessionStorage.setItem(VISITED_KEY, '1');
  } catch (_) {
    // Tetap aman bila penyimpanan browser dinonaktifkan.
  }

  if (!homepagePaths.has(pathname)) return;

  const navigation = performance.getEntriesByType('navigation')[0];
  const navigationType = navigation && navigation.type || 'navigate';
  const isReload = navigationType === 'reload';
  const isBackOrForward = navigationType === 'back_forward';
  const forcePreview = new URLSearchParams(location.search).get('intro') === '1';

  let fromOwnWebsite = false;
  try {
    const previous = new URL(document.referrer);
    fromOwnWebsite = previous.origin === location.origin;
  } catch (_) {
    // Saat masuk dari bookmark / URL langsung, referrer bisa kosong.
  }

  // Aturan:
  // - Masuk pertama kali: TAMPIL
  // - Refresh (F5/Ctrl+R) di Beranda: TAMPIL
  // - Klik menu Beranda dari halaman lain: LEWATI
  // - Tombol Back/Forward: LEWATI
  // - ?intro=1: paksa tampil untuk keperluan pratinjau
  const shouldShow = forcePreview || isReload || (
    !isBackOrForward && !hasVisited && !fromOwnWebsite
  );
  if (!shouldShow) return;

  const video = intro.querySelector('video');
  const closeButtons = [...intro.querySelectorAll('[data-hst-close]')];
  const mainButton = intro.querySelector('.hst-intro__enter');
  const reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let closed = false;
  let safetyTimer;
  let restoreTimer;

  function hideNow() {
    intro.hidden = true;
    document.body.classList.remove('hst-intro-locked');
    clearTimeout(restoreTimer);
  }

  function closeIntro() {
    if (closed) return;
    closed = true;
    clearTimeout(safetyTimer);
    if (video) video.pause();
    intro.classList.add('hst-intro--closing');
    document.body.classList.remove('hst-intro-locked');

    function hide() {
      if (intro.hidden) return;
      hideNow();
      const main = document.querySelector('main');
      if (main) {
        if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
        main.focus({ preventScroll: true });
      }
    }

    intro.addEventListener('transitionend', event => {
      if (event.target === intro && event.propertyName === 'opacity') hide();
    }, { once: true });
    restoreTimer = setTimeout(hide, reduceMotion ? 0 : 650);
  }

  intro.hidden = false;
  document.body.classList.add('hst-intro-locked');
  closeButtons.forEach(button => button.addEventListener('click', closeIntro));

  intro.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeIntro();
    }
    if (event.key !== 'Tab' || closeButtons.length < 2) return;
    const first = closeButtons[0];
    const last = closeButtons[closeButtons.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // Saat halaman dipulihkan dari cache tombol Back, langsung sembunyikan intro.
  window.addEventListener('pageshow', event => {
    if (event.persisted) {
      closed = true;
      clearTimeout(safetyTimer);
      if (video) video.pause();
      hideNow();
    }
  });

  safetyTimer = setTimeout(closeIntro, reduceMotion ? 2600 : 7000);
  if (video && !reduceMotion) {
    video.muted = true;
    video.addEventListener('timeupdate', () => {
      if (Number.isFinite(video.duration) && video.duration > 0) {
        intro.style.setProperty('--hst-progress',
          String(Math.min(1, video.currentTime / video.duration)));
      }
    });
    video.addEventListener('ended', () => setTimeout(closeIntro, 360), { once: true });
    video.addEventListener('error', () => setTimeout(closeIntro, 2400), { once: true });
    const playback = video.play();
    if (playback && typeof playback.catch === 'function') {
      playback.catch(() => setTimeout(closeIntro, 2700));
    }
  }
  if (mainButton) mainButton.focus({ preventScroll: true });
}


/* =========================================================
   JAM WITA PADA IDENTITAS PUBLIK
========================================================= */

function initBrandClock() {
const clock =
        document.querySelector(
            '.js-mc-clock'
        );

    if (!clock) {
        return;
    }

    const formatter =
        new Intl.DateTimeFormat(
            'id-ID',
            {
                timeZone:
                    'Asia/Makassar',

                hour:
                    '2-digit',

                minute:
                    '2-digit',

                second:
                    '2-digit',

                hour12:
                    false
            }
        );

    const updateClock = () => {

        const parts =
            formatter.formatToParts(
                new Date()
            );

        let hour = '';
        let minute = '';
        let second = '';

        for (
            const part of parts
        ) {

            if (
                part.type === 'hour'
            ) {
                hour =
                    part.value;
            }

            if (
                part.type === 'minute'
            ) {
                minute =
                    part.value;
            }

            if (
                part.type === 'second'
            ) {
                second =
                    part.value;
            }

        }

        clock.textContent =
            `${hour}.${minute}.${second} WITA`;
    };

    updateClock();

    window.setInterval(
        updateClock,
        1000
    );
}



/* =========================================================
   AKSI DETAIL BERITA: CETAK, SALIN, BAGIKAN
========================================================= */

function initArticleActions() {
'use strict';
    const printButton =
        document.getElementById(
            'print-article'
        );
    const copyButton =
        document.getElementById(
            'copy-link'
        );
    const copyText =
        document.getElementById(
            'copy-text'
        );
    const shareButton =
        document.getElementById(
            'share-article'
        );
    if (printButton) {
        printButton.addEventListener(
            'click',
            () => {
                window.print();
            }
        );
    }
    const fallbackCopy =
        () => {
            const textarea =
                document.createElement(
                    'textarea'
                );
            textarea.value =
                window.location.href;
            textarea.setAttribute(
                'readonly',
                ''
            );
            textarea.style.position =
                'fixed';
            textarea.style.opacity =
                '0';
            textarea.style.pointerEvents =
                'none';
            document.body.appendChild(
                textarea
            );
            textarea.select();
            const copied =
                document.execCommand(
                    'copy'
                );
            textarea.remove();
            return copied;
        };
    if (
        copyButton
        &&
        copyText
    ) {
        copyButton.addEventListener(
            'click',
            async () => {
                let success =
                    false;
                try {
                    if (
                        navigator.clipboard
                        &&
                        window.isSecureContext
                    ) {
                        await navigator
                            .clipboard
                            .writeText(
                                window.location.href
                            );
                        success =
                            true;
                    } else {
                        success =
                            fallbackCopy();
                    }
                } catch (error) {
                    success =
                        fallbackCopy();
                }
                copyText.textContent =
                    success
                        ? 'Tautan Tersalin'
                        : 'Gagal Menyalin';
                window.setTimeout(
                    () => {
                        copyText.textContent =
                            'Salin Tautan';
                    },
                    1800
                );
            }
        );
    }
    if (
        shareButton
        &&
        typeof navigator.share
        === 'function'
    ) {
        shareButton.hidden =
            false;
        shareButton.addEventListener(
            'click',
            async () => {
                try {
                    await navigator.share({
                        title:
                            document.title,
                        url:
                            window.location.href
                    });
                } catch (error) {
                }
            }
        );
    }
}

