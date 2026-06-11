/*
 * app.js — converter studio UI: upload → extract → options → live preview → download.
 * All state lives here; extraction is PptxExtract, generation is DeckBuilder.
 * DOM is built with createElement/textContent only — no innerHTML.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------ theme presets

  function mix(hexA, hexB, t) {
    var a = parseInt(hexA.slice(1), 16), b = parseInt(hexB.slice(1), 16);
    var r = Math.round((a >> 16 & 255) * (1 - t) + (b >> 16 & 255) * t);
    var g = Math.round((a >> 8 & 255) * (1 - t) + (b >> 8 & 255) * t);
    var bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }
  function luminance(hex) {
    var n = parseInt(hex.slice(1), 16);
    return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  }

  var PRESETS = [
    { id: 'midnight', name: 'Midnight', theme: { bg: '#0b1220', bg2: '#101a30', text: '#e8eefc', muted: '#93a4c4', accent: '#4da8ff', accent2: '#7ab4ff' } },
    { id: 'paper',    name: 'Paper',    theme: { bg: '#f6f4ee', bg2: '#fffdf7', text: '#222733', muted: '#697186', accent: '#2563eb', accent2: '#7c3aed' } },
    { id: 'sunset',   name: 'Sunset',   theme: { bg: '#1a1023', bg2: '#2a1430', text: '#fdeee4', muted: '#c9a6a4', accent: '#ff7849', accent2: '#ffb86b' } },
    { id: 'forest',   name: 'Forest',   theme: { bg: '#0c1512', bg2: '#12211b', text: '#e6f2ea', muted: '#9ab8a8', accent: '#34d399', accent2: '#a3e635' } },
    { id: 'slate',    name: 'Slate',    theme: { bg: '#16181d', bg2: '#1d2026', text: '#ececf1', muted: '#9aa0ab', accent: '#e2e8f0', accent2: '#94a3b8' } },
    { id: 'plum',     name: 'Plum',     theme: { bg: '#150d1d', bg2: '#1f1230', text: '#f3eafe', muted: '#b39cc9', accent: '#c084fc', accent2: '#f472b6' } },
    { id: 'ember',    name: 'Ember',    theme: { bg: '#171010', bg2: '#241313', text: '#fcefe8', muted: '#c2a39a', accent: '#ef4444', accent2: '#f97316' } }
  ];

  function themeFromDeck(colors) {
    if (!colors || !colors.accent1) return null;
    var base = colors.dk2 || colors.dk1 || '#101a30';
    var light = colors.lt1 || '#f5f5f5';
    var dark = colors.dk1 || '#111111';
    if (luminance(base) > 0.55) {
      // light original theme
      return {
        bg: colors.lt2 || mix(light, '#000000', 0.03), bg2: light,
        text: dark, muted: mix(dark, light, 0.42),
        accent: colors.accent1, accent2: colors.accent2 || mix(colors.accent1, light, 0.3)
      };
    }
    return {
      bg: mix(base, '#000000', 0.35), bg2: base,
      text: light, muted: mix(light, base, 0.45),
      accent: colors.accent1, accent2: colors.accent2 || mix(colors.accent1, light, 0.35)
    };
  }

  var COLOR_LABELS = {
    bg: 'Background', bg2: 'Background glow', text: 'Text',
    muted: 'Muted text', accent: 'Accent', accent2: 'Accent 2'
  };

  // ------------------------------------------------------------------- state

  var state = {
    buffer: null,        // original .pptx bytes (for re-parse on compress toggle)
    fileName: null,
    content: null,       // PptxExtract result
    html: '',
    presetId: 'midnight',
    options: DeckBuilder.defaults()
  };

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    landing: $('landing'), studio: $('studio'),
    dropzone: $('dropzone'), fileInput: $('file-input'), sample: $('sample-link'),
    progress: $('parse-progress'), ppLabel: $('pp-label'), ppFill: $('pp-fill'),
    errorBox: $('error-box'),
    preview: $('preview'), deckName: $('deck-name'), deckStats: $('deck-stats'),
    warnings: $('warnings'), warningsList: $('warnings-list'),
    download: $('download'), openTab: $('open-tab'),
    swatches: $('theme-swatches'), customColors: $('custom-colors'),
    fxDesc: $('fx-desc'), tipNotes: $('tip-notes')
  };

  // -------------------------------------------------------------- persistence

  function saveOptions() {
    try {
      localStorage.setItem('pptx2html.options', JSON.stringify({
        presetId: state.presetId, options: state.options
      }));
    } catch (e) { /* private mode etc. — fine */ }
  }
  function restoreOptions() {
    try {
      var raw = localStorage.getItem('pptx2html.options');
      if (!raw) return;
      var saved = JSON.parse(raw);
      if (saved && saved.options) {
        var merged = DeckBuilder.defaults();
        deepMerge(merged, saved.options);
        merged.title = DeckBuilder.defaults().title; // title always comes from the deck
        state.options = merged;
        state.presetId = saved.presetId || 'custom';
      }
    } catch (e) { /* corrupted storage — ignore */ }
  }
  function deepMerge(into, from) {
    for (var k in from) {
      if (into[k] && typeof into[k] === 'object' && !Array.isArray(into[k]) &&
          from[k] && typeof from[k] === 'object') deepMerge(into[k], from[k]);
      else if (from[k] !== undefined) into[k] = from[k];
    }
  }

  // ------------------------------------------------------------ build/preview

  var buildTimer = null;
  function rebuild(immediate) {
    if (!state.content) return;
    clearTimeout(buildTimer);
    buildTimer = setTimeout(function () {
      state.html = DeckBuilder.build(state.content, state.options);
      els.preview.srcdoc = state.html;
      saveOptions();
    }, immediate ? 0 : 120);
  }

  function showError(msg) {
    els.errorBox.textContent = msg;
    els.errorBox.classList.add('show');
    els.progress.classList.remove('show');
  }

  function setProgress(done, totalCount, label) {
    els.progress.classList.add('show');
    els.ppLabel.textContent = label || 'Working…';
    els.ppFill.style.width = (totalCount ? Math.round(done / totalCount * 100) : 0) + '%';
  }

  // --------------------------------------------------------------- file flow

  function acceptFile(file) {
    if (!file) return;
    if (!/\.(pptx|ppsx)$/i.test(file.name)) {
      showError('“' + file.name + '” doesn’t look like a PowerPoint file — I can read .pptx and .ppsx.');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { showError('Could not read the file. Try again?'); };
    reader.onload = function () { startParse(reader.result, file.name); };
    reader.readAsArrayBuffer(file);
  }

  function startParse(buffer, name) {
    els.errorBox.classList.remove('show');
    state.buffer = buffer;
    state.fileName = name;
    setProgress(0, 1, 'Opening ' + name + '…');
    PptxExtract.parse(buffer, {
      compressImages: $('opt-compress').checked,
      onProgress: setProgress
    }).then(function (content) {
      state.content = content;
      onParsed();
    }).catch(function (err) {
      showError('That file could not be converted: ' + (err && err.message ? err.message : err));
    });
  }

  function onParsed() {
    var c = state.content;
    els.progress.classList.remove('show');

    // deck title from first slide (fallback: file name)
    var baseName = state.fileName.replace(/\.(pptx|ppsx)$/i, '');
    state.options.title = (c.slides[0] && c.slides[0].title) || baseName;

    // theme-from-deck swatch
    renderSwatches();
    if (state.presetId === 'deck') applyPreset('deck', true);

    // notes availability
    var hasNotes = c.slides.some(function (s) { return s.notes; });
    var notesCheck = $('notes-check');
    notesCheck.classList.toggle('disabled', !hasNotes);
    $('opt-notes').checked = hasNotes && state.options.includeNotes;
    els.tipNotes.style.display = hasNotes && state.options.includeNotes ? '' : 'none';

    // meta line
    els.deckName.textContent = state.fileName;
    var s = c.stats;
    var bits = [s.slides + ' slides'];
    if (s.images) bits.push(s.images + (s.images === 1 ? ' image' : ' images'));
    if (s.tables) bits.push(s.tables + (s.tables === 1 ? ' table' : ' tables'));
    if (s.charts) bits.push(s.charts + ' chart' + (s.charts === 1 ? '' : 's') + ' (placeholder)');
    if (s.notes) bits.push('speaker notes on ' + s.notes);
    els.deckStats.textContent = bits.join(' · ');

    // warnings
    els.warningsList.textContent = '';
    if (c.warnings.length) {
      c.warnings.slice(0, 12).forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w;
        els.warningsList.appendChild(li);
      });
      els.warnings.classList.add('show');
    } else {
      els.warnings.classList.remove('show');
    }

    els.landing.style.display = 'none';
    els.studio.classList.add('show');
    rebuild(true);
  }

  // ----------------------------------------------------------------- swatches

  function renderSwatches() {
    els.swatches.textContent = '';
    var list = PRESETS.slice();
    var deckTheme = state.content ? themeFromDeck(state.content.themeColors) : null;
    if (deckTheme) list.unshift({ id: 'deck', name: 'Your deck', theme: deckTheme });
    list.forEach(function (p) {
      var b = document.createElement('button');
      b.className = 'swatch' + (state.presetId === p.id ? ' on' : '');
      b.type = 'button';
      b.title = p.name;
      var chip = document.createElement('div');
      chip.className = 'sw-chip';
      chip.style.background = 'linear-gradient(135deg,' + p.theme.bg2 + ',' + p.theme.bg + ')';
      chip.style.setProperty('--sw-accent', p.theme.accent);
      chip.style.setProperty('--sw-text', p.theme.text);
      var nameEl = document.createElement('div');
      nameEl.className = 'sw-name';
      nameEl.textContent = p.name;
      b.appendChild(chip);
      b.appendChild(nameEl);
      b.addEventListener('click', function () { applyPreset(p.id); });
      els.swatches.appendChild(b);
    });
    renderCustomColors();
  }

  function applyPreset(id, silent) {
    var deckTheme = state.content ? themeFromDeck(state.content.themeColors) : null;
    var preset = id === 'deck' ? (deckTheme && { theme: deckTheme }) :
      PRESETS.filter(function (p) { return p.id === id; })[0];
    if (!preset) return;
    state.presetId = id;
    state.options.theme = JSON.parse(JSON.stringify(preset.theme));
    renderSwatches();
    if (!silent) rebuild();
  }

  function renderCustomColors() {
    els.customColors.textContent = '';
    Object.keys(COLOR_LABELS).forEach(function (key) {
      var row = document.createElement('label');
      row.className = 'color-field';
      var input = document.createElement('input');
      input.type = 'color';
      input.value = state.options.theme[key];
      var span = document.createElement('span');
      span.textContent = COLOR_LABELS[key];
      input.addEventListener('input', function () {
        state.options.theme[key] = input.value;
        state.presetId = 'custom';
        var on = els.swatches.querySelector('.swatch.on');
        if (on) on.classList.remove('on');
        rebuild();
      });
      row.appendChild(input); row.appendChild(span);
      els.customColors.appendChild(row);
    });
  }

  // ------------------------------------------------------------ seg controls

  function initSeg(id, get, set) {
    var el = $(id);
    var opts = JSON.parse(el.getAttribute('data-opts'));
    opts.forEach(function (o) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = o[1];
      b.dataset.value = o[0];
      b.addEventListener('click', function () {
        set(o[0]);
        syncSeg(el, get());
        rebuild();
      });
      el.appendChild(b);
    });
    syncSeg(el, get());
  }
  function syncSeg(el, value) {
    Array.prototype.forEach.call(el.children, function (b) {
      b.classList.toggle('on', b.dataset.value === value);
    });
  }

  // -------------------------------------------------------------- option wire

  function wireOptions() {
    var o = state.options;

    initSeg('opt-placement', function () { return o.nav.placement; }, function (v) { o.nav.placement = v; });
    initSeg('opt-shape', function () { return o.nav.shape; }, function (v) { o.nav.shape = v; });
    initSeg('opt-labels', function () { return o.nav.labels; }, function (v) { o.nav.labels = v; });
    initSeg('opt-effect-show', function () { return o.effectShow; }, function (v) { o.effectShow = v; });
    initSeg('opt-transition', function () { return o.transition; }, function (v) { o.transition = v; });

    // font
    $('opt-font').value = o.font;
    $('opt-font').addEventListener('change', function () { o.font = this.value; rebuild(); });

    // nav opacity
    var nop = $('opt-nav-opacity'), nopOut = $('opt-nav-opacity-out');
    nop.value = Math.round(o.nav.opacity * 100);
    nopOut.textContent = nop.value + '%';
    nop.addEventListener('input', function () {
      o.nav.opacity = nop.value / 100;
      nopOut.textContent = nop.value + '%';
      rebuild();
    });

    // checkboxes
    function check(id, getV, setV) {
      var el = $(id);
      el.checked = getV();
      el.addEventListener('change', function () { setV(el.checked); rebuild(); });
    }
    check('opt-counter', function () { return o.nav.showCounter; }, function (v) { o.nav.showCounter = v; });
    check('opt-top-counter', function () { return o.nav.showTopCounter; }, function (v) { o.nav.showTopCounter = v; });
    check('opt-progress', function () { return o.progressBar; }, function (v) { o.progressBar = v; });
    check('opt-underline', function () { return o.flairUnderline; }, function (v) { o.flairUnderline = v; });
    check('opt-corners', function () { return o.flairCorners; }, function (v) { o.flairCorners = v; });
    check('opt-notes', function () { return o.includeNotes; }, function (v) {
      o.includeNotes = v;
      els.tipNotes.style.display = v ? '' : 'none';
    });

    // effects
    var effSel = $('opt-effect');
    Backgrounds.list().forEach(function (e) {
      var op = document.createElement('option');
      op.value = e.id; op.textContent = e.label;
      effSel.appendChild(op);
    });
    effSel.value = o.effect;
    function syncFxFields() {
      var none = effSel.value === 'none';
      $('fx-show-field').style.opacity = none ? 0.4 : 1;
      $('fx-intensity-field').style.opacity = none ? 0.4 : 1;
      $('fx-show-field').style.pointerEvents = none ? 'none' : '';
      $('fx-intensity-field').style.pointerEvents = none ? 'none' : '';
      var meta = Backgrounds.list().filter(function (e) { return e.id === effSel.value; })[0];
      els.fxDesc.textContent = meta ? meta.desc : '';
    }
    syncFxFields();
    effSel.addEventListener('change', function () {
      o.effect = effSel.value;
      syncFxFields();
      rebuild();
    });

    var inten = $('opt-intensity'), intenOut = $('opt-intensity-out');
    inten.value = Math.round(o.effectIntensity * 100);
    intenOut.textContent = inten.value + '%';
    inten.addEventListener('input', function () {
      o.effectIntensity = inten.value / 100;
      intenOut.textContent = inten.value + '%';
      rebuild();
    });

    // compress — needs a re-parse of the original bytes
    $('opt-compress').addEventListener('change', function () {
      if (state.buffer) startParse(state.buffer, state.fileName);
    });

    // reset
    $('reset-options').addEventListener('click', function () {
      var title = state.options.title;
      state.options = DeckBuilder.defaults();
      state.options.title = title;
      state.presetId = 'midnight';
      try { localStorage.removeItem('pptx2html.options'); } catch (e) { /* fine */ }
      resetPanelDom();
      wireOptions();
      renderSwatches();
      rebuild();
    });
  }

  // Drop all listeners/options so wireOptions() can run again cleanly.
  function resetPanelDom() {
    ['opt-placement', 'opt-shape', 'opt-labels', 'opt-effect-show', 'opt-transition',
     'opt-effect'].forEach(function (id) {
      var el = $(id);
      var clone = el.cloneNode(false);
      clone.textContent = '';
      el.replaceWith(clone);
    });
    ['opt-font', 'opt-nav-opacity', 'opt-counter', 'opt-top-counter', 'opt-progress',
     'opt-underline', 'opt-corners', 'opt-notes', 'opt-compress', 'reset-options'].forEach(function (id) {
      var el = $(id);
      el.replaceWith(el.cloneNode(true));
    });
  }

  // -------------------------------------------------------------- actions

  function deckFileName() {
    return (state.fileName || 'slideshow').replace(/\.(pptx|ppsx)$/i, '') + '-slideshow.html';
  }

  els.download.addEventListener('click', function () {
    if (!state.html) return;
    var blob = new Blob([state.html], { type: 'text/html;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = deckFileName();
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  });

  els.openTab.addEventListener('click', function () {
    if (!state.html) return;
    var blob = new Blob([state.html], { type: 'text/html;charset=utf-8' });
    window.open(URL.createObjectURL(blob), '_blank');
  });

  $('upload-another').addEventListener('click', function () {
    els.studio.classList.remove('show');
    els.landing.style.display = '';
    els.fileInput.value = '';
  });

  // ----------------------------------------------------------- upload events

  els.fileInput.addEventListener('change', function () { acceptFile(this.files[0]); });

  ['dragenter', 'dragover'].forEach(function (ev) {
    els.dropzone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      els.dropzone.classList.add('drag');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.dropzone.addEventListener(ev, function (e) {
      e.preventDefault(); e.stopPropagation();
      els.dropzone.classList.remove('drag');
    });
  });
  els.dropzone.addEventListener('drop', function (e) {
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    acceptFile(f);
  });

  els.sample.addEventListener('click', function (e) {
    e.preventDefault();
    setProgress(0, 1, 'Fetching the sample deck…');
    fetch('files/test.pptx').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    }).then(function (buf) {
      startParse(buf, 'sample-deck.pptx');
    }).catch(function () {
      showError('Couldn’t fetch the sample (this works on the hosted site, but not from file://). Upload any .pptx instead.');
    });
  });

  // --------------------------------------------------------------------- go

  restoreOptions();
  wireOptions();
  renderSwatches();

})();
