(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.documentElement.classList.add("js");

  // reveal once on scroll
  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      });
    }, { rootMargin: "0px 0px -60px 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add("in"); });
  }

  // the notch conversation
  var lines = [
    ["You", "What is the weather like today?"],
    ["Thinking", "Checking Open-Meteo"],
    ["Jarvis", "Eighteen degrees and clear, sir."],
    ["You", "Aaj ka match kisne jeeta?"],
    ["Thinking", "Asking Claude, with web search"],
    ["Jarvis", "One moment, sir. I have the score."]
  ];
  var texts = document.querySelectorAll(".island-text");
  var step = 0;
  function show(i) {
    texts.forEach(function (t) {
      t.querySelector(".island-label").textContent = lines[i][0];
      t.querySelector(".island-line").textContent = lines[i][1];
    });
  }
  if (!reduce && texts.length) {
    setInterval(function () {
      if (document.hidden) return;
      step = (step + 1) % lines.length;
      texts.forEach(function (t) { t.classList.add("out"); });
      setTimeout(function () {
        show(step);
        texts.forEach(function (t) { t.classList.remove("out"); });
      }, 320);
    }, 2800);
  }

  // the blob: glowing blue liquid with two eyes that follow the cursor and blink
  var main = document.getElementById("blob");
  var mirror = document.getElementById("blob-mirror");
  if (!main || !main.getContext) return;
  var ctx = main.getContext("2d");
  var mctx = mirror && mirror.getContext ? mirror.getContext("2d") : null;
  var U = 132; // drawing units; the canvas scales to its box
  var px = 0, dpr = 1;

  function fit() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = main.clientWidth || U;
    px = Math.round(size * dpr);
    main.width = main.height = px;
    if (mirror) { mirror.width = mirror.height = px; }
  }

  var pointer = null;
  window.addEventListener("pointermove", function (e) { pointer = { x: e.clientX, y: e.clientY }; }, { passive: true });
  document.addEventListener("pointerleave", function () { pointer = null; });

  var lx = 0, ly = 0;          // eased look direction, -1..1
  var nextBlink = 1600, blinkAt = -1;

  function draw(ms) {
    var t = ms / 1000;
    var k = px / U;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, U, U);

    // where to look
    var tx, ty;
    if (pointer) {
      var r = main.getBoundingClientRect();
      var dx = pointer.x - (r.left + r.width / 2);
      var dy = pointer.y - (r.top + r.height / 2);
      var d = Math.sqrt(dx * dx + dy * dy);
      tx = dx / (d + 160); ty = dy / (d + 160);
    } else {
      tx = Math.sin(t * 0.7) * 0.5; ty = Math.sin(t * 0.43 + 1) * 0.3;
    }
    lx += (tx - lx) * 0.12; ly += (ty - ly) * 0.12;

    // blink
    if (blinkAt < 0 && ms > nextBlink) blinkAt = ms;
    var open = 1;
    if (blinkAt >= 0) {
      var b = (ms - blinkAt) / 160;
      if (b >= 1) { blinkAt = -1; nextBlink = ms + 2200 + Math.random() * 3200; }
      else open = Math.abs(1 - b * 2) * 0.9 + 0.1;
    }

    var cx = U / 2 + lx * 3, cy = U / 2 + ly * 2;

    // halo
    var halo = ctx.createRadialGradient(cx, cy, 18, cx, cy, 62);
    halo.addColorStop(0, "rgba(56,189,248,0.42)");
    halo.addColorStop(1, "rgba(56,189,248,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, U, U);

    // liquid body
    var R = 30 + Math.sin(t * 1.3) * 1.2;
    ctx.beginPath();
    for (var i = 0; i <= 72; i++) {
      var a = (i / 72) * Math.PI * 2;
      var rr = R * (1 + 0.055 * Math.sin(3 * a + t * 1.6) + 0.04 * Math.sin(5 * a - t * 2.1) + 0.03 * Math.sin(2 * a + t * 0.9));
      var x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.closePath();
    var body = ctx.createRadialGradient(cx - 9, cy - 11, 2, cx, cy, R + 4);
    body.addColorStop(0, "#e0f7ff");
    body.addColorStop(0.3, "#7dd3fc");
    body.addColorStop(0.68, "#38bdf8");
    body.addColorStop(1, "#0284c7");
    ctx.save();
    ctx.shadowColor = "rgba(56,189,248,0.9)";
    ctx.shadowBlur = 22 * k;
    ctx.fillStyle = body;
    ctx.fill();
    ctx.restore();

    // eyes
    var ex = cx + lx * 6, ey = cy - 1 + ly * 4;
    ctx.fillStyle = "#06131f";
    [-9.5, 9.5].forEach(function (off) {
      ctx.beginPath();
      ctx.ellipse(ex + off, ey, 3.6, 7.4 * open, 0, 0, Math.PI * 2);
      ctx.fill();
    });
    if (open > 0.6) {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      [-9.5, 9.5].forEach(function (off) {
        ctx.beginPath();
        ctx.arc(ex + off + 1, ey - 3.4, 1.2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (mctx) {
      mctx.clearRect(0, 0, px, px);
      mctx.drawImage(main, 0, 0);
    }
  }

  function loop(ms) {
    if (!document.hidden) draw(ms);
    requestAnimationFrame(loop);
  }

  fit();
  window.addEventListener("resize", function () { fit(); if (reduce) draw(0); });
  if (reduce) {
    draw(0);
    // still follows the cursor, without the idle animation
    window.addEventListener("pointermove", function () { lx = ly = 0; draw(0); draw(0); }, { passive: true });
  } else {
    requestAnimationFrame(loop);
  }
})();
