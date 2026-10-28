(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* WhatsApp links: add a pre-filled message from data-wa */
  document.querySelectorAll("a[data-wa]").forEach(function (a) {
    a.href = "https://wa.me/972542645053?text=" + encodeURIComponent(a.getAttribute("data-wa"));
  });

  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();

  /* Sunlight caustics on a shallow sandy bottom, drawn at low resolution
     and scaled up by CSS. One frame only when the user prefers less motion. */
  var canvas = document.getElementById("caustics");
  if (canvas && canvas.getContext) {
    var ctx = canvas.getContext("2d");
    var W = 168, H = 96;
    canvas.width = W; canvas.height = H;
    var img = ctx.createImageData(W, H);
    var data = img.data;
    var running = false, raf = 0, last = 0;

    function draw(t) {
      var i = 0;
      for (var y = 0; y < H; y++) {
        for (var x = 0; x < W; x++) {
          var u = x / W * 9, v = y / H * 5.2;
          var s = Math.sin(u * 1.3 + t * 0.9) + Math.sin(v * 1.7 - t * 0.7)
                + Math.sin((u + v) * 0.9 + t * 0.5) + Math.sin(Math.sqrt(u * u * 0.8 + v * v) * 1.6 - t * 1.1);
          var c = 1 - Math.abs(Math.sin(s * 1.15));
          c = c * c * c * c * c * c;
          /* bright lines are pale foam, the gaps stay transparent */
          data[i] = 242; data[i + 1] = 252; data[i + 2] = 250;
          data[i + 3] = Math.min(255, c * 300);
          i += 4;
        }
      }
      ctx.putImageData(img, 0, 0);
    }

    function loop(now) {
      if (!running) return;
      if (now - last > 50) { draw(now / 1000); last = now; } /* ~20fps is enough for water */
      raf = requestAnimationFrame(loop);
    }

    if (reduceMotion) {
      draw(2.4);
    } else if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        var visible = entries[0].isIntersecting;
        if (visible && !running) { running = true; raf = requestAnimationFrame(loop); }
        if (!visible && running) { running = false; cancelAnimationFrame(raf); }
      }).observe(canvas);
    } else {
      draw(2.4);
    }
  }

  /* Depth gauge on the page edge: maps scroll position to the depth of the
     section in view (0, 6, 18, 30, 40 m) */
  var meter = document.querySelector(".depthometer");
  if (meter) {
    var bob = meter.querySelector(".bob");
    var read = meter.querySelector(".read");
    var unit = meter.getAttribute("data-unit") || "m";
    var zones = Array.prototype.slice.call(document.querySelectorAll("[data-depth]"));
    var maxDepth = 40;
    var ticking = false;

    function update() {
      ticking = false;
      var mid = window.innerHeight * 0.45;
      var depth = 0;
      for (var k = 0; k < zones.length; k++) {
        var r = zones[k].getBoundingClientRect();
        var d0 = parseFloat(zones[k].getAttribute("data-depth"));
        var d1 = k + 1 < zones.length ? parseFloat(zones[k + 1].getAttribute("data-depth")) : d0;
        if (r.top <= mid && r.bottom > mid) {
          var p = (mid - r.top) / Math.max(1, r.height);
          depth = d0 + (d1 - d0) * p;
          break;
        }
        if (r.bottom <= mid) depth = d1;
      }
      bob.style.top = Math.min(100, depth / maxDepth * 100) + "%";
      read.textContent = Math.round(depth) + " " + unit;
      meter.style.color = depth >= 14 ? "var(--foam)" : "var(--ink)";
    }

    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(update); }
    }, { passive: true });
    window.addEventListener("resize", update);
    update();
  }
})();
