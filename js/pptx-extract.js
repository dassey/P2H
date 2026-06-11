/*
 * pptx-extract.js — client-side PPTX content extractor.
 *
 * Reads a .pptx (zip of OOXML parts) with JSZip 2.x + DOMParser and returns a
 * neutral content model the deck builder can re-style:
 *
 *   PptxExtract.parse(arrayBuffer, { compressImages, onProgress }) → Promise<{
 *     slides: [{ type, title, subtitle, blocks, notes }],
 *     themeColors: { dk1, lt1, dk2, lt2, accent1..accent6 } | null,
 *     aspect: number,            // slide width / height
 *     warnings: [string],
 *     stats: { slides, images, tables, charts, notes }
 *   }>
 *
 * Block kinds:
 *   { kind:'bullets', items:[{ text, html, level, noBullet }] }
 *   { kind:'image',   src, aspect, name }
 *   { kind:'table',   rows:[[cellText]] , headerRow:bool }
 *   { kind:'stub',    label }            // charts / SmartArt / video
 *
 * Layout fidelity is intentionally NOT preserved — content is re-styled by the
 * deck builder. Shapes are read in y-position order so reading order survives.
 */
(function (global) {
  'use strict';

  var SKIP_PLACEHOLDERS = { dt: 1, sldNum: 1, ftr: 1, hdr: 1 };

  // ---------- tiny XML helpers (namespace-prefix agnostic) ----------

  function parseXml(text) {
    var doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) {
      throw new Error('XML parse error');
    }
    return doc;
  }

  // Direct + deep search by localName, ignoring namespace prefixes.
  function all(el, localName) {
    var out = [], nodes = el.getElementsByTagName('*');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].localName === localName) out.push(nodes[i]);
    }
    return out;
  }

  function first(el, localName) {
    var nodes = el.getElementsByTagName('*');
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].localName === localName) return nodes[i];
    }
    return null;
  }

  // First matching descendant following a localName path, e.g. path(sp,'nvSpPr','nvPr','ph')
  function path(el) {
    var cur = el;
    for (var i = 1; i < arguments.length && cur; i++) {
      var name = arguments[i], found = null;
      for (var c = cur.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === name) { found = c; break; }
      }
      cur = found;
    }
    return cur || null;
  }

  function children(el, localName) {
    var out = [];
    for (var c = el.firstElementChild; c; c = c.nextElementSibling) {
      if (c.localName === localName) out.push(c);
    }
    return out;
  }

  function attr(el, name) { return el ? el.getAttribute(name) : null; }

  // r:id / r:embed live in the relationships namespace; getAttribute with the
  // qualified name works because PowerPoint always emits the "r" prefix, but
  // fall back to a scan in case of exotic producers.
  function rAttr(el, local) {
    if (!el) return null;
    var v = el.getAttribute('r:' + local);
    if (v) return v;
    for (var i = 0; i < el.attributes.length; i++) {
      if (el.attributes[i].localName === local) return el.attributes[i].value;
    }
    return null;
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- zip helpers ----------

  function zipText(zip, name) {
    var f = zip.file(name);
    return f ? f.asText() : null;
  }

  function zipXml(zip, name) {
    var t = zipText(zip, name);
    return t ? parseXml(t) : null;
  }

  function resolvePath(baseDir, target) {
    if (!target) return null;
    if (target.charAt(0) === '/') return target.slice(1);
    var parts = (baseDir + '/' + target).split('/'), out = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p === '' || p === '.') continue;
      if (p === '..') out.pop(); else out.push(p);
    }
    return out.join('/');
  }

  // rels file for a part: dir/_rels/name.rels  → { rId: {type, target} }
  function readRels(zip, partName) {
    var slash = partName.lastIndexOf('/');
    var dir = partName.slice(0, slash);
    var file = partName.slice(slash + 1);
    var relsDoc = zipXml(zip, dir + '/_rels/' + file + '.rels');
    var map = {};
    if (!relsDoc) return map;
    var rels = all(relsDoc, 'Relationship');
    for (var i = 0; i < rels.length; i++) {
      var type = attr(rels[i], 'Type') || '';
      var external = attr(rels[i], 'TargetMode') === 'External';
      map[attr(rels[i], 'Id')] = {
        type: type.slice(type.lastIndexOf('/') + 1), // e.g. "image", "slideLayout"
        external: external,
        // external targets (URLs, mailto:) must stay verbatim — only
        // in-package parts get resolved against the part's directory
        target: external ? attr(rels[i], 'Target') : resolvePath(dir, attr(rels[i], 'Target'))
      };
    }
    return map;
  }

  function uint8ToBase64(u8) {
    var CHUNK = 0x8000, parts = [];
    for (var i = 0; i < u8.length; i += CHUNK) {
      parts.push(String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK)));
    }
    return btoa(parts.join(''));
  }

  var MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml'
  };

  // ---------- image pipeline ----------

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image decode failed')); };
      img.src = src;
    });
  }

  function hasAlpha(img) {
    var c = document.createElement('canvas');
    c.width = 48; c.height = 48;
    var ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, 48, 48);
    var d = ctx.getImageData(0, 0, 48, 48).data;
    for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
    return false;
  }

  // Downscale to ≤ maxEdge and re-encode big opaque images as JPEG so the
  // exported deck stays emailable. GIF/SVG pass through untouched.
  function processImage(dataUri, mime, byteLen, compress) {
    if (!compress || mime === 'image/gif' || mime === 'image/svg+xml') {
      return Promise.resolve({ src: dataUri, aspect: null });
    }
    return loadImage(dataUri).then(function (img) {
      var maxEdge = 1600;
      var w = img.naturalWidth, h = img.naturalHeight;
      var aspect = w && h ? w / h : null;
      var needScale = Math.max(w, h) > maxEdge;
      var alpha = mime === 'image/png' && hasAlpha(img);
      var needRecode = !alpha && (byteLen > 250 * 1024 || mime === 'image/bmp');
      if (!needScale && !needRecode) return { src: dataUri, aspect: aspect };

      var scale = needScale ? maxEdge / Math.max(w, h) : 1;
      var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      var out = alpha ? c.toDataURL('image/png')
                      : c.toDataURL('image/jpeg', 0.85);
      // Keep whichever encoding is actually smaller.
      if (out.length >= dataUri.length) out = dataUri;
      return { src: out, aspect: aspect };
    }).catch(function () {
      return { src: dataUri, aspect: null }; // fall back to the original bytes
    });
  }

  // ---------- text extraction ----------

  function runHtml(r, rels, warnings) {
    var tEl = first(r, 't');
    var text = tEl ? tEl.textContent : '';
    if (!text) return '';
    var html = escapeHtml(text);
    var rPr = path(r, 'rPr');
    if (rPr) {
      if (attr(rPr, 'b') === '1') html = '<strong>' + html + '</strong>';
      if (attr(rPr, 'i') === '1') html = '<em>' + html + '</em>';
      if (attr(rPr, 'u') && attr(rPr, 'u') !== 'none') html = '<u>' + html + '</u>';
      var link = first(rPr, 'hlinkClick');
      var rid = link ? rAttr(link, 'id') : null;
      // only genuine external web/mail links become anchors; internal
      // slide-jump links stay as plain text in the export
      if (rid && rels[rid] && rels[rid].external &&
          /^(https?:|mailto:)/i.test(rels[rid].target || '')) {
        html = '<a href="' + escapeHtml(rels[rid].target) + '" target="_blank" rel="noopener">' + html + '</a>';
      }
    }
    return html;
  }

  // txBody → array of { text, html, level, noBullet }
  function extractParagraphs(txBody, rels, warnings) {
    var out = [];
    var paras = children(txBody, 'p');
    for (var i = 0; i < paras.length; i++) {
      var p = paras[i];
      var pPr = path(p, 'pPr');
      var level = pPr ? parseInt(attr(pPr, 'lvl') || '0', 10) : 0;
      var noBullet = !!(pPr && first(pPr, 'buNone'));
      var text = '', html = '';
      for (var c = p.firstElementChild; c; c = c.nextElementSibling) {
        if (c.localName === 'r') {
          var tEl = first(c, 't');
          text += tEl ? tEl.textContent : '';
          html += runHtml(c, rels, warnings);
        } else if (c.localName === 'br') {
          text += '\n'; html += '<br>';
        } else if (c.localName === 'fld') { // slide number / date fields
          var ft = first(c, 't');
          if (ft) { text += ft.textContent; html += escapeHtml(ft.textContent); }
        }
      }
      if (text.replace(/\s+/g, '') === '') continue;
      out.push({ text: text.trim(), html: html, level: level, noBullet: noBullet });
    }
    return out;
  }

  // ---------- shape walking ----------

  function emuPos(spLike) {
    var xfrm = first(spLike, 'xfrm');
    var off = xfrm ? path(xfrm, 'off') : null;
    return {
      x: off ? parseInt(attr(off, 'x') || '0', 10) : null,
      y: off ? parseInt(attr(off, 'y') || '0', 10) : null
    };
  }

  // Collect content items from an spTree (recursing into groups).
  function walkTree(treeEl, rels, items, warnings, groupPos) {
    for (var c = treeEl.firstElementChild; c; c = c.nextElementSibling) {
      var name = c.localName;
      if (name === 'sp') {
        var ph = path(c, 'nvSpPr', 'nvPr', 'ph');
        var phType = ph ? (attr(ph, 'type') || 'body') : null;
        if (phType && SKIP_PLACEHOLDERS[phType]) continue;
        var txBody = path(c, 'txBody');
        if (!txBody) continue;
        var paras = extractParagraphs(txBody, rels, warnings);
        if (!paras.length) continue;
        var pos = emuPos(path(c, 'spPr') || c);
        items.push({
          itemType: 'text', phType: phType,
          y: pos.y != null ? pos.y : (groupPos || null),
          paras: paras
        });
      } else if (name === 'pic') {
        var blip = first(c, 'blip');
        var embed = blip ? rAttr(blip, 'embed') : null;
        var rel = embed ? rels[embed] : null;
        if (rel && rel.target) {
          var pos2 = emuPos(path(c, 'spPr') || c);
          var nv = path(c, 'nvPicPr', 'cNvPr');
          items.push({
            itemType: 'image', target: rel.target,
            name: nv ? (attr(nv, 'name') || '') : '',
            y: pos2.y != null ? pos2.y : (groupPos || null)
          });
        }
      } else if (name === 'graphicFrame') {
        var gd = first(c, 'graphicData');
        var uri = attr(gd, 'uri') || '';
        var pos3 = emuPos(c);
        if (/table$/.test(uri)) {
          var tbl = first(gd, 'tbl');
          if (tbl) items.push({ itemType: 'table', tbl: tbl, y: pos3.y, rels: rels });
        } else if (/chart$/.test(uri)) {
          items.push({ itemType: 'chart', el: gd, y: pos3.y });
        } else if (/diagram$/.test(uri)) {
          items.push({ itemType: 'stub', label: 'SmartArt diagram', y: pos3.y });
        }
      } else if (name === 'grpSp') {
        var gpos = emuPos(path(c, 'grpSpPr') || c);
        walkTree(c, rels, items, warnings, gpos.y);
      }
      // cxnSp (connectors) carry no content worth keeping — skipped.
    }
  }

  function tableRows(tbl) {
    var rows = [];
    var trs = children(tbl, 'tr');
    for (var r = 0; r < trs.length; r++) {
      var cells = [];
      var tcs = children(trs[r], 'tc');
      for (var c = 0; c < tcs.length; c++) {
        var tx = first(tcs[c], 'txBody');
        var txt = '';
        if (tx) {
          var paras = extractParagraphs(tx, {}, []);
          txt = paras.map(function (p) { return p.text; }).join(' ');
        }
        cells.push(txt);
      }
      rows.push(cells);
    }
    var firstRowStyled = attr(tbl.parentElement ? first(tbl, 'tblPr') : null, 'firstRow') === '1' ||
                         attr(first(tbl, 'tblPr'), 'firstRow') === '1';
    return { rows: rows, headerRow: firstRowStyled };
  }

  function chartLabel(zip, slideRels, gd) {
    try {
      var chartEl = first(gd, 'chart');
      var rid = chartEl ? rAttr(chartEl, 'id') : null;
      var rel = rid ? slideRels[rid] : null;
      if (rel && rel.target) {
        var cdoc = zipXml(zip, rel.target);
        if (cdoc) {
          var title = first(cdoc, 'title');
          if (title) {
            var ts = all(title, 't').map(function (t) { return t.textContent; }).join('');
            if (ts.trim()) return 'Chart: ' + ts.trim();
          }
          var plot = first(cdoc, 'plotArea');
          if (plot) {
            for (var c = plot.firstElementChild; c; c = c.nextElementSibling) {
              if (/Chart$/.test(c.localName)) {
                return c.localName.replace(/Chart$/, '') + ' chart';
              }
            }
          }
        }
      }
    } catch (e) { /* label is best-effort */ }
    return 'Chart';
  }

  // ---------- notes ----------

  function extractNotes(zip, slideRels) {
    for (var id in slideRels) {
      if (slideRels[id].type === 'notesSlide') {
        var doc = zipXml(zip, slideRels[id].target);
        if (!doc) return null;
        var sps = all(doc, 'sp'), lines = [];
        for (var i = 0; i < sps.length; i++) {
          var ph = path(sps[i], 'nvSpPr', 'nvPr', 'ph');
          if (!ph || attr(ph, 'type') !== 'body') continue;
          var tx = path(sps[i], 'txBody');
          if (!tx) continue;
          extractParagraphs(tx, {}, []).forEach(function (p) { lines.push(p.text); });
        }
        var s = lines.join('\n').trim();
        return s || null;
      }
    }
    return null;
  }

  // ---------- theme ----------

  function extractTheme(zip, presRels) {
    var target = null;
    for (var id in presRels) {
      if (presRels[id].type === 'theme') { target = presRels[id].target; break; }
    }
    var doc = zipXml(zip, target || 'ppt/theme/theme1.xml');
    if (!doc) return null;
    var scheme = first(doc, 'clrScheme');
    if (!scheme) return null;
    var colors = {};
    for (var c = scheme.firstElementChild; c; c = c.nextElementSibling) {
      var srgb = first(c, 'srgbClr');
      var sys = first(c, 'sysClr');
      var val = srgb ? attr(srgb, 'val') : (sys ? attr(sys, 'lastClr') : null);
      if (val) colors[c.localName] = '#' + val.toLowerCase();
    }
    return Object.keys(colors).length ? colors : null;
  }

  // ---------- slide classification ----------

  function classify(slide, index) {
    var textLen = 0, hasImage = false, hasTable = false, hasStub = false, bulletCount = 0;
    slide.blocks.forEach(function (b) {
      if (b.kind === 'image') hasImage = true;
      if (b.kind === 'table') hasTable = true;
      if (b.kind === 'stub') hasStub = true;
      if (b.kind === 'bullets') {
        bulletCount += b.items.length;
        b.items.forEach(function (it) { textLen += it.text.length; });
      }
    });
    var contentFree = !hasImage && !hasTable && !hasStub;
    if (slide.isCtrTitle && index === 0) return 'title';
    if ((slide.isCtrTitle || (slide.title && textLen < 60 && bulletCount <= 1)) && contentFree) {
      return index === 0 ? 'title' : 'section';
    }
    if (hasTable) return 'table';
    if (hasImage && textLen < 200) return 'image';
    return 'content';
  }

  // ---------- main ----------

  function parse(arrayBuffer, opts) {
    opts = opts || {};
    var onProgress = opts.onProgress || function () {};
    var compress = opts.compressImages !== false;

    return new Promise(function (resolve) { resolve(new JSZip(arrayBuffer)); })
      .then(function (zip) {
        var presXml = zipXml(zip, 'ppt/presentation.xml');
        if (!presXml) throw new Error('Not a PowerPoint file (ppt/presentation.xml missing).');
        var presRels = readRels(zip, 'ppt/presentation.xml');

        // slide order
        var slidePaths = [];
        var idLst = first(presXml, 'sldIdLst');
        if (idLst) {
          children(idLst, 'sldId').forEach(function (sid) {
            var rid = rAttr(sid, 'id');
            if (rid && presRels[rid]) slidePaths.push(presRels[rid].target);
          });
        }
        if (!slidePaths.length) { // fallback: natural sort of slide parts
          zip.filter(function (p) { return /^ppt\/slides\/slide\d+\.xml$/.test(p); })
            .forEach(function (f) { slidePaths.push(f.name); });
          slidePaths.sort(function (a, b) {
            return parseInt(a.replace(/\D/g, ''), 10) - parseInt(b.replace(/\D/g, ''), 10);
          });
        }
        if (!slidePaths.length) throw new Error('No slides found in this file.');

        // aspect ratio
        var sldSz = first(presXml, 'sldSz');
        var aspect = sldSz
          ? parseInt(attr(sldSz, 'cx'), 10) / parseInt(attr(sldSz, 'cy'), 10)
          : 16 / 9;

        var themeColors = extractTheme(zip, presRels);
        var warnings = [];
        var stats = { slides: slidePaths.length, images: 0, tables: 0, charts: 0, notes: 0 };

        // sequential processing keeps memory bounded and progress meaningful
        var slides = [];
        var chain = Promise.resolve();
        slidePaths.forEach(function (sp, idx) {
          chain = chain.then(function () {
            onProgress(idx, slidePaths.length, 'Reading slide ' + (idx + 1));
            return parseSlide(zip, sp, idx, compress, warnings, stats);
          }).then(function (slide) { slides.push(slide); });
        });

        return chain.then(function () {
          slides.forEach(function (s, i) { s.type = classify(s, i); delete s.isCtrTitle; });
          onProgress(slidePaths.length, slidePaths.length, 'Done');
          return {
            slides: slides, themeColors: themeColors, aspect: aspect,
            warnings: warnings, stats: stats
          };
        });
      });
  }

  function parseSlide(zip, partName, index, compress, warnings, stats) {
    var doc;
    try {
      doc = zipXml(zip, partName);
    } catch (e) { doc = null; }
    if (!doc) {
      warnings.push('Slide ' + (index + 1) + ' could not be read and was left blank.');
      return Promise.resolve({ title: null, subtitle: null, blocks: [], notes: null, isCtrTitle: false });
    }
    var rels = readRels(zip, partName);
    var spTree = first(doc, 'spTree');
    var items = [];
    if (spTree) walkTree(spTree, rels, items, warnings, null);

    // reading order: title first, then by y position, then document order
    items.forEach(function (it, i) { it.docOrder = i; });
    items.sort(function (a, b) {
      var ta = a.phType === 'ctrTitle' || a.phType === 'title' ? 0 : 1;
      var tb = b.phType === 'ctrTitle' || b.phType === 'title' ? 0 : 1;
      if (ta !== tb) return ta - tb;
      var ya = a.y != null ? a.y : Infinity;
      var yb = b.y != null ? b.y : Infinity;
      if (ya !== yb) return ya - yb;
      return a.docOrder - b.docOrder;
    });

    var slide = { title: null, subtitle: null, blocks: [], notes: null, isCtrTitle: false };
    var imagePromises = [];

    items.forEach(function (it) {
      if (it.itemType === 'text') {
        if ((it.phType === 'title' || it.phType === 'ctrTitle') && !slide.title) {
          slide.title = it.paras.map(function (p) { return p.text; }).join(' ');
          slide.isCtrTitle = it.phType === 'ctrTitle';
          return;
        }
        if (it.phType === 'subTitle' && !slide.subtitle) {
          slide.subtitle = it.paras.map(function (p) { return p.text; }).join('\n');
          return;
        }
        slide.blocks.push({ kind: 'bullets', items: it.paras });
      } else if (it.itemType === 'image') {
        var f = zip.file(it.target);
        if (!f) { warnings.push('Slide ' + (index + 1) + ': missing image ' + it.target); return; }
        var ext = it.target.slice(it.target.lastIndexOf('.') + 1).toLowerCase();
        var mime = MIME[ext];
        if (!mime) {
          warnings.push('Slide ' + (index + 1) + ': unsupported image type .' + ext + ' (skipped)');
          slide.blocks.push({ kind: 'stub', label: 'Image (.' + ext + ' not web-compatible)' });
          return;
        }
        var u8 = f.asUint8Array();
        var uri = 'data:' + mime + ';base64,' + uint8ToBase64(u8);
        var block = { kind: 'image', src: null, aspect: null, name: it.name || '' };
        slide.blocks.push(block);
        stats.images++;
        imagePromises.push(processImage(uri, mime, u8.length, compress).then(function (res) {
          block.src = res.src; block.aspect = res.aspect;
        }));
      } else if (it.itemType === 'table') {
        var t = tableRows(it.tbl);
        if (t.rows.length) { slide.blocks.push({ kind: 'table', rows: t.rows, headerRow: t.headerRow !== false }); stats.tables++; }
      } else if (it.itemType === 'chart') {
        slide.blocks.push({ kind: 'stub', label: chartLabel(zip, rels, it.el) });
        stats.charts++;
      } else if (it.itemType === 'stub') {
        slide.blocks.push({ kind: 'stub', label: it.label });
      }
    });

    slide.notes = extractNotes(zip, rels);
    if (slide.notes) stats.notes++;

    return Promise.all(imagePromises).then(function () {
      // drop image blocks that failed to produce a src
      slide.blocks = slide.blocks.filter(function (b) { return b.kind !== 'image' || b.src; });
      return slide;
    });
  }

  global.PptxExtract = { parse: parse, escapeHtml: escapeHtml };

})(window);
