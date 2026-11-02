'use strict';

document.addEventListener('DOMContentLoaded', () => {
  initAdminSidebar();
  initNewsImagePreview();
  initDeleteConfirmation();
});

function initAdminSidebar() {
  const sidebar = document.querySelector('[data-sb]');
  if (!sidebar) return;

  const body = document.body;
  const storageKey = 'hst_sidebar_state';

  try {
    if (localStorage.getItem(storageKey) === 'collapsed') {
      sidebar.classList.add('is-collapsed');
      body.classList.add('sb-collapsed');
    }
  } catch (_) {
    // Penyimpanan browser dapat dinonaktifkan oleh kebijakan perangkat.
  }

  const toggleButton = sidebar.querySelector('.sb-toggle');
  if (toggleButton) {
    const updateExpanded = () => {
      toggleButton.setAttribute(
        'aria-expanded',
        sidebar.classList.contains('is-collapsed') ? 'false' : 'true'
      );
    };

    updateExpanded();

    toggleButton.addEventListener('click', () => {
      const collapsed = sidebar.classList.toggle('is-collapsed');
      body.classList.toggle('sb-collapsed', collapsed);
      updateExpanded();

      try {
        localStorage.setItem(
          storageKey,
          collapsed ? 'collapsed' : 'expanded'
        );
      } catch (_) {
        // Navigasi tetap berfungsi meskipun preferensi tidak dapat disimpan.
      }
    });
  }

  sidebar.querySelectorAll('[data-sub-toggle]').forEach(button => {
    button.addEventListener('click', event => {
      if (sidebar.classList.contains('is-collapsed')) return;

      event.preventDefault();
      const group = button.closest('.sb-group');
      if (!group) return;

      const opened = group.classList.toggle('is-open');
      button.setAttribute('aria-expanded', opened ? 'true' : 'false');
    });
  });
}

function initNewsImagePreview() {
  const input = document.getElementById('gambar');
  const preview = document.getElementById('image-preview');
  const empty = document.getElementById('image-preview-empty');
  if (!input || !preview || !empty) return;

  let previewUrl = '';

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = '';
    }

    if (!file || !file.type.startsWith('image/')) {
      preview.removeAttribute('src');
      preview.style.display = 'none';
      empty.style.display = 'grid';
      return;
    }

    previewUrl = URL.createObjectURL(file);
    preview.src = previewUrl;
    preview.alt = 'Pratinjau gambar yang dipilih';
    preview.style.display = 'block';
    empty.style.display = 'none';
  });

  window.addEventListener('pagehide', () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, { once: true });
}

function initDeleteConfirmation() {
  document.querySelectorAll('form[data-confirm-message]').forEach(form => {
    form.addEventListener('submit', event => {
      const message = form.dataset.confirmMessage || 'Lanjutkan tindakan ini?';
      if (!window.confirm(message)) event.preventDefault();
    });
  });
}
