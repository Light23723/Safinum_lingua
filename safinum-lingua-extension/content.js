(() => {
  'use strict';

  // Safinum Lingua MVP: glossaire local uniquement, sans envoi de données à un serveur.
  const DEFAULT_GLOSSARY = { "Bonjour": "Mbolo" };
  let bundledGlossary = {};
  const TEXT_NODE_FILTER = NodeFilter.SHOW_TEXT;
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION',
    'CODE', 'PRE', 'SVG', 'PATH'
  ]);
  const TRANSLATABLE_ATTRIBUTES = ['placeholder', 'title', 'aria-label', 'alt'];

  let enabled = true;
  let glossary = { ...DEFAULT_GLOSSARY };
  let observer = null;
  let scheduled = false;
  let isRestoring = false;
  let translatedCount = 0;
  let unknownTexts = new Set();

  // Mémorise la valeur originale pour pouvoir restaurer l'interface sans recharger.
  const originalText = new WeakMap();
  const originalAttributes = new WeakMap();

  const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');
  const hasDigits = (value) => /\d/.test(value);

  function isExcludedElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return true;
    if (SKIP_TAGS.has(element.tagName)) return true;
    if (element.isContentEditable || element.closest('[contenteditable="true"]')) return true;
    if (element.closest('[data-safinum-lingua-ui]')) return true;
    return false;
  }

  function compileEntries() {
    return Object.entries(glossary)
      .filter(([source, target]) => {
        const s = String(source ?? '').trim();
        const t = String(target ?? '').trim();
        // Protection: aucun nombre, code, montant ou référence ne peut devenir une entrée.
        return s.length > 0 && t.length > 0 && !hasDigits(s) && !hasDigits(t);
      })
      .sort((a, b) => b[0].length - a[0].length);
  }

  function translateString(value) {
    if (!value || hasDigits(value)) return { value, changed: false, matched: false };

    let output = value;
    let matched = false;
    for (const [source, target] of compileEntries()) {
      const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Les limites Unicode évitent de remplacer une partie d'un autre mot.
      const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escaped})(?=$|[^\\p{L}\\p{N}])`, 'giu');
      output = output.replace(pattern, (_whole, prefix) => {
        matched = true;
        return `${prefix}${target}`;
      });
    }
    return { value: output, changed: output !== value, matched };
  }

  function getTextNodes(root = document.body) {
    if (!root) return [];
    const walker = document.createTreeWalker(root, TEXT_NODE_FILTER, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || isExcludedElement(parent)) return NodeFilter.FILTER_REJECT;
        if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function saveAttributeOriginal(element, attr, value) {
    let map = originalAttributes.get(element);
    if (!map) {
      map = new Map();
      originalAttributes.set(element, map);
    }
    if (!map.has(attr)) map.set(attr, value);
  }

  function processTextNode(node) {
    const current = node.nodeValue;
    const stored = originalText.get(node);

    // Un changement externe (framework du site) remplace l'ancienne référence.
    if (stored && current !== stored.translated) {
      originalText.delete(node);
    } else if (stored && current === stored.translated) {
      return;
    }

    const source = node.nodeValue;
    const trimmed = source.trim();
    if (!trimmed) return;

    // Un nœud avec chiffres est laissé intact : montants, dates, comptes, références.
    if (hasDigits(trimmed)) return;

    const result = translateString(source);
    if (result.changed) {
      originalText.set(node, { original: source, translated: result.value });
      node.nodeValue = result.value;
      translatedCount += 1;
    } else if (trimmed.length <= 160) {
      const norm = normalize(trimmed);
      const knownSource = compileEntries().some(([key]) => normalize(key) === norm);
      if (!knownSource && !/^[\p{P}\p{S}\s]+$/u.test(trimmed)) unknownTexts.add(trimmed);
    }
  }

  function processAttributes(root = document.body) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) return;
    const elements = [root, ...root.querySelectorAll('*')];
    for (const element of elements) {
      if (isExcludedElement(element)) continue;
      for (const attr of TRANSLATABLE_ATTRIBUTES) {
        if (!element.hasAttribute(attr)) continue;
        const current = element.getAttribute(attr) || '';
        const storedMap = originalAttributes.get(element);
        const stored = storedMap?.get(attr);
        if (stored && current !== stored.translated) {
          storedMap.delete(attr);
        } else if (stored && current === stored.translated) {
          continue;
        }
        if (!current.trim() || hasDigits(current)) continue;
        const result = translateString(current);
        if (result.changed) {
          saveAttributeOriginal(element, attr, current);
          const map = originalAttributes.get(element);
          map.set(attr, { original: current, translated: result.value });
          element.setAttribute(attr, result.value);
          translatedCount += 1;
        } else if (current.length <= 160) {
          unknownTexts.add(current.trim());
        }
      }
    }
  }

  function publishStatus() {
    try {
      chrome.runtime.sendMessage({
        type: 'SAFINUM_LINGUA_STATUS',
        payload: {
          enabled,
          translatedCount,
          unknownTexts: [...unknownTexts].slice(0, 60)
        }
      }, () => void chrome.runtime.lastError);
    } catch (_error) {
      // La fenêtre popup peut être fermée : aucun impact sur la page.
    }
  }

  function scan(root = document.body) {
    if (!enabled || !root) return;
    const before = translatedCount;
    const beforeUnknown = unknownTexts.size;
    for (const node of getTextNodes(root)) processTextNode(node);
    if (root.nodeType === Node.ELEMENT_NODE) processAttributes(root);
    if (translatedCount !== before || unknownTexts.size !== beforeUnknown) publishStatus();
  }

  function scheduleScan() {
    if (!enabled || scheduled || isRestoring) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan(document.body);
    });
  }

  function restoreAll() {
    isRestoring = true;
    for (const node of getTextNodes(document.body)) {
      const stored = originalText.get(node);
      if (stored && node.nodeValue === stored.translated) node.nodeValue = stored.original;
    }
    const all = document.body ? [document.body, ...document.body.querySelectorAll('*')] : [];
    for (const element of all) {
      const map = originalAttributes.get(element);
      if (!map) continue;
      for (const [attr, stored] of map.entries()) {
        if (element.getAttribute(attr) === stored.translated) element.setAttribute(attr, stored.original);
      }
    }
    isRestoring = false;
    translatedCount = 0;
    unknownTexts = new Set();
    publishStatus();
  }

  async function loadSettings() {
    try {
      const values = await chrome.storage.local.get(['safinumEnabled', 'safinumGlossary']);
      try {
        const response = await fetch(chrome.runtime.getURL('glossaire.json'));
        if (response.ok) {
          const packaged = await response.json();
          if (packaged && typeof packaged === 'object' && !Array.isArray(packaged)) {
            bundledGlossary = Object.fromEntries(Object.entries(packaged).filter(([k, v]) => typeof k === 'string' && typeof v === 'string' && k.trim() && v.trim()));
          }
        }
      } catch (_error) {
        bundledGlossary = {};
      }
      enabled = values.safinumEnabled !== false;
      // Priorité : glossaire embarqué, puis modifications locales de l'utilisateur.
      glossary = { ...DEFAULT_GLOSSARY, ...bundledGlossary, ...(values.safinumGlossary || {}) };
    } catch (_error) {
      enabled = true;
      glossary = { ...DEFAULT_GLOSSARY, ...bundledGlossary };
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SAFINUM_LINGUA_GET_STATUS') {
      sendResponse({
        enabled,
        translatedCount,
        unknownTexts: [...unknownTexts].slice(0, 60),
        glossaryCount: Object.keys(glossary).length
      });
      return true;
    }
    if (message?.type === 'SAFINUM_LINGUA_RESCAN') {
      translatedCount = 0;
      unknownTexts = new Set();
      scan(document.body);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.safinumEnabled) enabled = changes.safinumEnabled.newValue !== false;
    if (changes.safinumGlossary) glossary = { ...DEFAULT_GLOSSARY, ...bundledGlossary, ...(changes.safinumGlossary.newValue || {}) };

    if (!enabled) {
      restoreAll();
    } else {
      translatedCount = 0;
      unknownTexts = new Set();
      scan(document.body);
    }
  });

  async function start() {
    await loadSettings();
    if (enabled) scan(document.body);

    observer = new MutationObserver((mutations) => {
      if (!enabled || isRestoring) return;
      // Ne rescanner que les ajouts et les changements de texte, puis regrouper par frame.
      for (const mutation of mutations) {
        if (mutation.type === 'childList' || mutation.type === 'characterData' || mutation.type === 'attributes') {
          scheduleScan();
          break;
        }
      }
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: TRANSLATABLE_ATTRIBUTES
    });
    publishStatus();
  }

  start();
})();
