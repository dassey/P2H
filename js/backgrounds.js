/*
 * backgrounds.js — library of animated canvas backgrounds for generated decks.
 *
 * Each effect is ONE self-contained function (canvas, BG) with no outside
 * references, so the deck builder can embed it verbatim into the exported
 * file via Function.prototype.toString(). BG = { accent, accent2, text, bg,
 * intensity } — hex colors plus a 0..1 density multiplier.
 *
 * Conventions every effect follows:
 *  - owns its resize handling and requestAnimationFrame loop
 *  - skips drawing while canvas.dataset.paused === '1' (slide has it hidden)
 *  - works in CSS pixels (visual softness is fine for a background layer)
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------- radar
  function radar(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, centerX, centerY, time = 0, contacts = [];
    function hexA(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    var A = BG.accent, A2 = BG.accent2;
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      centerX = width * 0.5; centerY = height * 0.5;
      makeContacts();
    }
    function makeContacts() {
      contacts = [];
      var maxR = Math.min(width, height) * 0.42, minR = Math.min(width, height) * 0.12;
      function make(type, count) {
        for (var i = 0; i < count; i++) {
          var angle = type === 'hostile'
            ? (Math.PI * 2 * i / count) + (Math.random() - 0.5) * 0.6
            : Math.random() * Math.PI * 2;
          contacts.push({
            type: type, baseAngle: angle,
            baseRadius: minR + Math.random() * (maxR - minR),
            driftPhase: Math.random() * Math.PI * 2,
            lastPing: -10000, x: 0, y: 0, bearing: 0
          });
        }
      }
      var k = Math.max(0.4, BG.intensity);
      make('hostile', Math.round(7 * k));
      make('friendly', Math.round(4 * k));
      make('unknown', 2);
    }
    function drawGrid() {
      var g = 60;
      ctx.strokeStyle = hexA(A, 0.08); ctx.lineWidth = 1;
      for (var x = 0; x < width; x += g) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (var y = 0; y < height; y += g) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
      ctx.strokeStyle = hexA(A, 0.18);
      for (x = 0; x < width; x += g * 5) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke(); }
      for (y = 0; y < height; y += g * 5) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); }
    }
    function drawContours() {
      ctx.strokeStyle = hexA(A2, 0.20); ctx.lineWidth = 1;
      var drift = time * 0.0001;
      for (var c = 0; c < 8; c++) {
        ctx.beginPath();
        var yBase = (height / 7) * c, amp = 40 + c * 8, freq = 0.003 + c * 0.0002, ps = c * 1.7 + drift;
        for (var x = 0; x <= width; x += 4) {
          var y = yBase + Math.sin(x * freq + ps) * amp
                + Math.sin(x * freq * 2.3 + ps * 0.7) * (amp * 0.3)
                + Math.cos(x * freq * 0.7 - ps * 1.3) * (amp * 0.4);
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    function updateContacts() {
      contacts.forEach(function (c) {
        c.x = centerX + Math.cos(c.baseAngle) * c.baseRadius + Math.sin(time * 0.0002 + c.driftPhase) * 12;
        c.y = centerY + Math.sin(c.baseAngle) * c.baseRadius + Math.cos(time * 0.00015 + c.driftPhase) * 12;
        c.bearing = Math.atan2(c.y - centerY, c.x - centerX);
        if (c.bearing < 0) c.bearing += Math.PI * 2;
      });
    }
    function drawSweep() {
      var sa = (time * 0.0003) % (Math.PI * 2);
      var mr = Math.sqrt(width * width + height * height) / 2;
      for (var i = 0; i < 30; i++) {
        ctx.strokeStyle = hexA(A2, (1 - i / 30) * 0.06);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(centerX + Math.cos(sa - i * 0.015) * mr, centerY + Math.sin(sa - i * 0.015) * mr);
        ctx.stroke();
      }
      ctx.strokeStyle = hexA(A2, 0.4); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + Math.cos(sa) * mr, centerY + Math.sin(sa) * mr); ctx.stroke();
      ctx.strokeStyle = hexA(A, 0.1); ctx.lineWidth = 1;
      for (var r = 1; r <= 4; r++) {
        ctx.beginPath(); ctx.arc(centerX, centerY, (mr * 0.9 / 4) * r, 0, Math.PI * 2); ctx.stroke();
      }
      return sa;
    }
    function drawContacts(sweepAngle) {
      var ns = sweepAngle % (Math.PI * 2);
      if (ns < 0) ns += Math.PI * 2;
      contacts.forEach(function (c) {
        var ad = ns - c.bearing;
        if (ad < 0) ad += Math.PI * 2;
        if (ad < 0.03) c.lastPing = time;
        var fade = Math.max(0, 1 - (time - c.lastPing) / 4000);
        if (fade <= 0) return;
        var color = c.type === 'hostile' ? 'rgba(255,90,90,' + fade + ')'
          : c.type === 'friendly' ? hexA(A2, fade)
          : 'rgba(255,200,90,' + fade + ')';
        ctx.strokeStyle = c.type === 'hostile' ? 'rgba(255,90,90,' + fade * 0.5 + ')'
          : c.type === 'friendly' ? hexA(A2, fade * 0.5)
          : 'rgba(255,200,90,' + fade * 0.5 + ')';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(c.x, c.y, 12 + (1 - fade) * 18, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = color;
        ctx.beginPath();
        if (c.type === 'hostile') {
          ctx.moveTo(c.x, c.y - 6); ctx.lineTo(c.x + 6, c.y);
          ctx.lineTo(c.x, c.y + 6); ctx.lineTo(c.x - 6, c.y); ctx.closePath();
        } else if (c.type === 'friendly') {
          ctx.arc(c.x, c.y, 5, 0, Math.PI * 2);
        } else {
          ctx.moveTo(c.x, c.y - 6); ctx.lineTo(c.x + 6, c.y + 5);
          ctx.lineTo(c.x - 6, c.y + 5); ctx.closePath();
        }
        ctx.fill();
      });
    }
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        drawGrid(); drawContours(); updateContacts();
        drawContacts(drawSweep());
        time += 16;
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // ------------------------------------------------------------ starfield
  function starfield(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, stars = [], meteor = null, time = 0;
    function hexA(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      stars = [];
      var count = Math.round(width * height / 4500 * Math.max(0.3, BG.intensity));
      for (var i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * width, y: Math.random() * height,
          z: 0.3 + Math.random() * 0.7,           // depth → size, speed, brightness
          tw: Math.random() * Math.PI * 2         // twinkle phase
        });
      }
    }
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < stars.length; i++) {
          var s = stars[i];
          s.x -= s.z * 0.25;
          if (s.x < -2) { s.x = width + 2; s.y = Math.random() * height; }
          var a = (0.35 + 0.65 * Math.abs(Math.sin(time * 0.001 + s.tw))) * s.z;
          ctx.fillStyle = i % 7 === 0 ? hexA(BG.accent2, a) : hexA(BG.text, a * 0.8);
          ctx.beginPath(); ctx.arc(s.x, s.y, s.z * 1.6, 0, Math.PI * 2); ctx.fill();
        }
        if (!meteor && Math.random() < 0.004) {
          meteor = { x: Math.random() * width * 0.8 + width * 0.2, y: -10, vx: -7 - Math.random() * 4, vy: 5 + Math.random() * 3, life: 1 };
        }
        if (meteor) {
          meteor.x += meteor.vx; meteor.y += meteor.vy; meteor.life -= 0.016;
          ctx.strokeStyle = hexA(BG.accent, Math.max(0, meteor.life) * 0.9);
          ctx.lineWidth = 2; ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(meteor.x, meteor.y);
          ctx.lineTo(meteor.x - meteor.vx * 6, meteor.y - meteor.vy * 6);
          ctx.stroke();
          if (meteor.life <= 0 || meteor.y > height + 60) meteor = null;
        }
        time += 16;
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // -------------------------------------------------------- constellation
  function constellation(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, nodes = [];
    function hexA(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    var LINK = 150;
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      nodes = [];
      var count = Math.round(width * height / 16000 * Math.max(0.3, BG.intensity));
      for (var i = 0; i < count; i++) {
        nodes.push({
          x: Math.random() * width, y: Math.random() * height,
          vx: (Math.random() - 0.5) * 0.45, vy: (Math.random() - 0.5) * 0.45
        });
      }
    }
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          n.x += n.vx; n.y += n.vy;
          if (n.x < 0 || n.x > width) n.vx *= -1;
          if (n.y < 0 || n.y > height) n.vy *= -1;
        }
        for (i = 0; i < nodes.length; i++) {
          for (var j = i + 1; j < nodes.length; j++) {
            var dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d < LINK) {
              ctx.strokeStyle = hexA(BG.accent, (1 - d / LINK) * 0.35);
              ctx.lineWidth = 1;
              ctx.beginPath(); ctx.moveTo(nodes[i].x, nodes[i].y);
              ctx.lineTo(nodes[j].x, nodes[j].y); ctx.stroke();
            }
          }
        }
        ctx.fillStyle = hexA(BG.accent2, 0.8);
        for (i = 0; i < nodes.length; i++) {
          ctx.beginPath(); ctx.arc(nodes[i].x, nodes[i].y, 2, 0, Math.PI * 2); ctx.fill();
        }
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // ----------------------------------------------------------------- waves
  function waves(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, time = 0;
    function hexA(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
    }
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        var rows = Math.round(10 * Math.max(0.4, BG.intensity)) + 2;
        var drift = time * 0.00012;
        for (var c = 0; c < rows; c++) {
          var t = c / (rows - 1);
          ctx.strokeStyle = hexA(c % 3 === 0 ? BG.accent : BG.accent2, 0.10 + t * 0.16);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          var yBase = height * (0.08 + 0.84 * t);
          var amp = 26 + t * 46, freq = 0.0028 + t * 0.0009, ps = c * 1.9 + drift;
          for (var x = 0; x <= width; x += 5) {
            var y = yBase + Math.sin(x * freq + ps) * amp
                  + Math.sin(x * freq * 2.1 + ps * 0.6) * amp * 0.35
                  + Math.cos(x * freq * 0.65 - ps * 1.4) * amp * 0.4;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        time += 16;
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // ------------------------------------------------------------- fireflies
  function fireflies(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, flies = [], time = 0;
    function rgb(hex) {
      var n = parseInt(hex.slice(1), 16);
      return (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255);
    }
    var C1 = rgb(BG.accent), C2 = rgb(BG.accent2);
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      flies = [];
      var count = Math.round(26 * Math.max(0.3, BG.intensity));
      for (var i = 0; i < count; i++) {
        flies.push({
          x: Math.random() * width, y: Math.random() * height,
          r: 2 + Math.random() * 3.5,
          p1: Math.random() * Math.PI * 2, p2: Math.random() * Math.PI * 2,
          s1: 0.00018 + Math.random() * 0.00025, s2: 0.00013 + Math.random() * 0.0002,
          glow: Math.random() * Math.PI * 2, c: Math.random() < 0.6 ? C1 : C2
        });
      }
    }
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < flies.length; i++) {
          var f = flies[i];
          f.x += Math.sin(time * f.s1 + f.p1) * 0.7;
          f.y += Math.cos(time * f.s2 + f.p2) * 0.55;
          if (f.x < -20) f.x = width + 20; if (f.x > width + 20) f.x = -20;
          if (f.y < -20) f.y = height + 20; if (f.y > height + 20) f.y = -20;
          var a = 0.25 + 0.75 * Math.abs(Math.sin(time * 0.0012 + f.glow));
          var g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, f.r * 6);
          g.addColorStop(0, 'rgba(' + f.c + ',' + a * 0.9 + ')');
          g.addColorStop(0.35, 'rgba(' + f.c + ',' + a * 0.35 + ')');
          g.addColorStop(1, 'rgba(' + f.c + ',0)');
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 6, 0, Math.PI * 2); ctx.fill();
        }
        time += 16;
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // -------------------------------------------------------------- confetti
  function confetti(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, bits = [];
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      bits = [];
      var palette = [BG.accent, BG.accent2, BG.text, '#ffd166', '#ef476f', '#06d6a0'];
      var count = Math.round(70 * Math.max(0.3, BG.intensity));
      for (var i = 0; i < count; i++) {
        bits.push({
          x: Math.random() * width, y: Math.random() * height,
          w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
          vy: 0.6 + Math.random() * 1.3, sway: Math.random() * Math.PI * 2,
          swaySpeed: 0.001 + Math.random() * 0.002,
          rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 0.06,
          color: palette[i % palette.length]
        });
      }
    }
    var time = 0;
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < bits.length; i++) {
          var b = bits[i];
          b.y += b.vy;
          b.x += Math.sin(time * b.swaySpeed + b.sway) * 0.8;
          b.rot += b.vr;
          if (b.y > height + 20) { b.y = -20; b.x = Math.random() * width; }
          ctx.save();
          ctx.translate(b.x, b.y); ctx.rotate(b.rot);
          ctx.globalAlpha = 0.85;
          // fold highlight: scale on a sine for a flutter feel
          ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(time * 0.002 + b.sway)));
          ctx.fillStyle = b.color;
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
          ctx.restore();
        }
        time += 16;
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // ------------------------------------------------------------------ snow
  function snow(canvas, BG) {
    var ctx = canvas.getContext('2d');
    var width, height, flakes = [], time = 0;
    function hexA(hex, a) {
      var n = parseInt(hex.slice(1), 16);
      return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')';
    }
    function resize() {
      width = canvas.width = window.innerWidth;
      height = canvas.height = window.innerHeight;
      flakes = [];
      var count = Math.round(width / 7 * Math.max(0.3, BG.intensity));
      for (var i = 0; i < count; i++) {
        flakes.push({
          x: Math.random() * width, y: Math.random() * height,
          r: 1 + Math.random() * 2.6, v: 0.35 + Math.random() * 0.9,
          sway: Math.random() * Math.PI * 2
        });
      }
    }
    function draw() {
      if (canvas.dataset.paused !== '1') {
        ctx.clearRect(0, 0, width, height);
        for (var i = 0; i < flakes.length; i++) {
          var f = flakes[i];
          f.y += f.v;
          f.x += Math.sin(time * 0.0008 + f.sway) * 0.45;
          if (f.y > height + 4) { f.y = -4; f.x = Math.random() * width; }
          ctx.fillStyle = hexA(BG.text, 0.25 + f.r / 4);
          ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2); ctx.fill();
        }
        time += 16;
      }
      requestAnimationFrame(draw);
    }
    resize();
    window.addEventListener('resize', resize);
    draw();
  }

  // ------------------------------------------------------------- registry

  var REGISTRY = [
    { id: 'none',          label: 'None',           desc: 'Clean background, no animation', fn: null },
    { id: 'radar',         label: 'Radar sweep',    desc: 'Tactical radar with grid and fading contact blips', fn: radar },
    { id: 'starfield',     label: 'Starfield',      desc: 'Drifting, twinkling stars with shooting stars', fn: starfield },
    { id: 'constellation', label: 'Constellation',  desc: 'Linked particles forming shifting webs', fn: constellation },
    { id: 'waves',         label: 'Flow lines',     desc: 'Calm flowing contour lines', fn: waves },
    { id: 'fireflies',     label: 'Fireflies',      desc: 'Soft glowing orbs that wander and pulse', fn: fireflies },
    { id: 'confetti',      label: 'Confetti',       desc: 'Celebratory fluttering confetti', fn: confetti },
    { id: 'snow',          label: 'Snowfall',       desc: 'Gentle snow drifting down', fn: snow }
  ];

  global.Backgrounds = {
    list: function () {
      return REGISTRY.map(function (e) { return { id: e.id, label: e.label, desc: e.desc }; });
    },
    // Serialized, ready-to-embed source of the effect function, or null.
    source: function (id) {
      for (var i = 0; i < REGISTRY.length; i++) {
        if (REGISTRY[i].id === id) return REGISTRY[i].fn ? REGISTRY[i].fn.toString() : null;
      }
      return null;
    }
  };

})(window);
