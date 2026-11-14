(() => {
  'use strict';

  const DEFAULT_GLOSSARY = { "Bonjour": "Mbolo" };
  let bundledGlossary = {};

  async function loadBundledGlossary() {
    const response = await fetch(chrome.runtime.getURL('glossaire.json'));
    if (!response.ok) throw new Error('Impossible de charger glossaire.json');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Format de glossaire invalide');
    return Object.fromEntries(Object.entries(data).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()));
  }
  const $ = (id) => document.getElementById(id);
  const els = {
    enabled: $('enabled'), pageMessage: $('pageMessage'), translatedCount: $('translatedCount'),
    unknownCount: $('unknownCount'), unknownSelect: $('unknownSelect'), sourceText: $('sourceText'),
    targetText: $('targetText'), saveTranslation: $('saveTranslation'), feedback: $('feedback'),
    glossaryList: $('glossaryList'), glossaryCount: $('glossaryCount'), rescan: $('rescan'),
    exportGlossary: $('exportGlossary'), importFile: $('importFile')
  };

  let glossary = { ...DEFAULT_GLOSSARY };
  let pageStatus = { enabled: true, translatedCount: 0, unknownTexts: [] };
  let activeTabId = null;
  let isTargetPage = false;

  const hasDigits = (value) => /\d/.test(value);

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    activeTabId = tab?.id ?? null;
    isTargetPage = Boolean(tab?.url && /^https:\/\/(www\.)?safinum\.cm\/hackathon-test(?:[/?#]|$)/i.test(tab.url));
    return tab;
  }

  async function getPageStatus() {
    if (activeTabId === null) return null;
    try {
      return await chrome.tabs.sendMessage(activeTabId, { type: 'SAFINUM_LINGUA_GET_STATUS' });
    } catch (_error) {
      return null;
    }
  }

  function renderStatus() {
    els.enabled.checked = pageStatus.enabled !== false;
    els.translatedCount.textContent = String(pageStatus.translatedCount || 0);
    els.unknownCount.textContent = String((pageStatus.unknownTexts || []).length);
    els.pageMessage.textContent = activeTabId === null
      ? 'Aucun onglet actif détecté.'
      : (isTargetPage
          ? 'Page Safinum détectée : les nouveaux textes sont surveillés automatiquement.'
          : 'Ouvre https://safinum.cm/hackathon-test pour activer la traduction.');

    const selected = els.unknownSelect.value;
    els.unknownSelect.innerHTML = '<option value="">— Choisir un texte —</option>';
    for (const text of pageStatus.unknownTexts || []) {
      const option = document.createElement('option');
      option.value = text;
      option.textContent = text;
      els.unknownSelect.appendChild(option);
    }
    if (selected && [...els.unknownSelect.options].some((o) => o.value === selected)) {
      els.unknownSelect.value = selected;
    }
  }

  function renderGlossary() {
    const entries = Object.entries(glossary).sort((a, b) => a[0].localeCompare(b[0], 'fr'));
    els.glossaryCount.textContent = `${entries.length} entrée${entries.length > 1 ? 's' : ''}`;
    els.glossaryList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = 'Aucune traduction enregistrée.';
      els.glossaryList.appendChild(empty);
      return;
    }
    for (const [source, target] of entries) {
      const row = document.createElement('div');
      row.className = 'glossary-row';
      const content = document.createElement('span');
      content.textContent = `${source} → `;
      const translated = document.createElement('b');
      translated.textContent = target;
      content.appendChild(translated);
      const remove = document.createElement('button');
      remove.className = 'delete-entry';
      remove.type = 'button';
      remove.textContent = 'Retirer';
      remove.setAttribute('aria-label', `Retirer ${source}`);
      remove.addEventListener('click', () => deleteEntry(source));
      row.append(content, remove);
      els.glossaryList.appendChild(row);
    }
  }

  async function refresh() {
    const stored = await chrome.storage.local.get(['safinumEnabled', 'safinumGlossary']);
    glossary = { ...DEFAULT_GLOSSARY, ...bundledGlossary, ...(stored.safinumGlossary || {}) };
    pageStatus.enabled = stored.safinumEnabled !== false;
    const status = await getPageStatus();
    if (status) pageStatus = status;
    renderStatus();
    renderGlossary();
  }

  async function saveTranslation() {
    const source = els.sourceText.value.trim();
    const target = els.targetText.value.trim();
    if (!source || !target) return setFeedback('Renseigne le texte français et sa traduction.', true);
    if (hasDigits(source) || hasDigits(target)) return setFeedback('Entrées refusées : chiffres et références doivent rester intacts.', true);
    if (source.length > 160 || target.length > 160) return setFeedback('Chaque expression doit faire 160 caractères maximum.', true);

    glossary[source] = target;
    await chrome.storage.local.set({ safinumGlossary: glossary });
    els.targetText.value = '';
    setFeedback('Traduction enregistrée. La page va être actualisée automatiquement.');
    await refresh();
    if (activeTabId !== null) {
      try { await chrome.tabs.sendMessage(activeTabId, { type: 'SAFINUM_LINGUA_RESCAN' }); } catch (_error) {}
    }
  }

  async function deleteEntry(source) {
    if (source === 'Bonjour') return setFeedback('L’entrée de démonstration « Bonjour » ne peut pas être retirée.', true);
    delete glossary[source];
    await chrome.storage.local.set({ safinumGlossary: glossary });
    setFeedback('Entrée retirée du glossaire.');
    await refresh();
  }

  function setFeedback(message, error = false) {
    els.feedback.textContent = message;
    els.feedback.style.color = error ? '#ff9d9d' : '#19d49b';
  }

  els.unknownSelect.addEventListener('change', () => {
    if (els.unknownSelect.value) els.sourceText.value = els.unknownSelect.value;
  });

  els.saveTranslation.addEventListener('click', saveTranslation);
  els.sourceText.addEventListener('keydown', (event) => { if (event.key === 'Enter') els.targetText.focus(); });
  els.targetText.addEventListener('keydown', (event) => { if (event.key === 'Enter') saveTranslation(); });

  els.enabled.addEventListener('change', async () => {
    await chrome.storage.local.set({ safinumEnabled: els.enabled.checked });
    pageStatus.enabled = els.enabled.checked;
    renderStatus();
  });

  els.rescan.addEventListener('click', async () => {
    if (activeTabId !== null) {
      try { await chrome.tabs.sendMessage(activeTabId, { type: 'SAFINUM_LINGUA_RESCAN' }); } catch (_error) {}
    }
    await refresh();
    setFeedback('Analyse terminée.');
  });

  els.exportGlossary.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(glossary, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'safinum-lingua-glossaire-duala.json';
    link.click();
    URL.revokeObjectURL(url);
    setFeedback('Glossaire exporté.');
  });

  els.importFile.addEventListener('change', async () => {
    const file = els.importFile.files?.[0];
    if (!file) return;
    try {
      const imported = JSON.parse(await file.text());
      if (!imported || typeof imported !== 'object' || Array.isArray(imported)) throw new Error('format');
      const safeEntries = {};
      for (const [source, target] of Object.entries(imported)) {
        if (typeof source !== 'string' || typeof target !== 'string' || !source.trim() || !target.trim()) continue;
        if (hasDigits(source) || hasDigits(target) || source.length > 160 || target.length > 160) continue;
        safeEntries[source.trim()] = target.trim();
      }
      glossary = { ...DEFAULT_GLOSSARY, ...bundledGlossary, ...safeEntries };
      await chrome.storage.local.set({ safinumGlossary: glossary });
      await refresh();
      setFeedback('Glossaire importé. Les entrées contenant des chiffres ont été ignorées.');
    } catch (_error) {
      setFeedback('Fichier JSON invalide.', true);
    } finally {
      els.importFile.value = '';
    }
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'SAFINUM_LINGUA_STATUS' && isTargetPage) {
      pageStatus = message.payload || pageStatus;
      renderStatus();
    }
  });

  (async () => {
    try {
      bundledGlossary = await loadBundledGlossary();
      await getActiveTab();
      await refresh();
      els.feedback.textContent = `Glossaire embarqué chargé : ${Object.keys(bundledGlossary).length} entrées.`;
    } catch (_error) {
      els.pageMessage.textContent = 'Impossible de charger le glossaire embarqué.';
    }
  })();
})();
