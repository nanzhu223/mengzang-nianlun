/* Ground-level courtyard exploration.
 * 2026-10-20：新增滚轮缩放（fov）+ 机位平滑过渡（位置阻尼），滚轮到达缩放极限后交还页面。 */
(function () {
  'use strict';
  window.NIANLUN_MODULES = window.NIANLUN_MODULES || {};

  window.NIANLUN_MODULES.createInteraction = function (o) {
    var T = o.THREE, camera = o.camera, canvas = o.canvas,
      section = canvas.closest('section'), cb = o.callbacks || {};

    var walking = false, enabled = true, disposed = false;
    var dragging = false, moved = false, keys = {}, held = null, heldAt = 0;

    /* 视线朝向（相对 yaw/pitch）+ 位置（pos → target 阻尼过渡） */
    var yaw = 0, pitch = 0, ty = 0, tp = 0;
    var lx = 0, ly = 0, sx = 0, sy = 0;
    var pos = new T.Vector3(), target = new T.Vector3();

    /* 机位过渡：定时插值 + 缓入缓出（而不是指数衰减的「急停」） */
    var trans = null;

    function easeInOutCubic(x) {
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }
    /* 角度走最短路径，避免从 350° 转到 10° 时绕一大圈 */
    function shortAngle(from, to) {
      var d = (to - from) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    /* 滚轮缩放：zoom>1 放大，zoom<1 缩小；用 fov 实现，不移动相机、不会穿墙 */
    var BASE_FOV = camera.fov || 52;
    var zoom = 1, tzoom = 1, ZMIN = 0.68, ZMAX = 2.3;

    var targets = o.targets || [], ray = new T.Raycaster(), ndc = new T.Vector2();

    var stops = {
      overview:  { p: [9, 3.5, 10.8],    l: [-2.6, 3.6, -4.2], n: '庭院全景' },
      entry:     { p: [3.4, 1.65, 5.5],  l: [-2.6, 3.8, -4.2], n: '院门内侧' },
      treeBase:  { p: [-0.7, 1.65, -0.4],l: [-2.6, 2.8, -4.2], n: '枣树下' },
      treeDetail:{ p: [-5.7, 1.65, -3.0],l: [-2.6, 2, -4.2],   n: '树皮近景' },
      gate:      { p: [3.4, 1.65, -6.9], l: [3.4, 2.4, -9.5],  n: '垂花门前' }
    };

    function on(el, event, fn, options) {
      el.addEventListener(event, fn, options);
      listeners.push(function () { el.removeEventListener(event, fn, options); });
    }
    var listeners = [];

    function clear() { keys = {}; held = null; dragging = false; canvas.classList.remove('grabbing'); }

    function apply() {
      camera.position.copy(pos);
      /* fov 缩放：放大时收窄视场，缩小时放宽 */
      var fov = Math.max(18, Math.min(86, BASE_FOV / zoom));
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.lookAt(
        pos.x + Math.sin(yaw) * Math.cos(pitch),
        pos.y + Math.sin(pitch),
        pos.z - Math.cos(yaw) * Math.cos(pitch)
      );
    }

    function view(id, instant) {
      clear();
      var stop = stops[id];
      walking = !!(stop && id !== 'overview');
      target.fromArray(stop ? stop.p : stops.overview.p);
      var d = new T.Vector3().fromArray(stop ? stop.l : stops.overview.l).sub(target);
      ty = Math.atan2(d.x, -d.z);
      tp = Math.atan2(d.y, Math.hypot(d.x, d.z));

      section.classList.toggle('is-exploring', walking);
      canvas.style.touchAction = walking ? 'none' : 'pan-y';
      if (cb.onState) cb.onState({ walking: walking, location: stop ? stop.n : '庭院全景' });

      /* 首次进入立即定位，之后由 update 阻尼过渡（解决机位切换突兀） */
      if (instant) {
        trans = null;
        pos.copy(target);
        yaw = ty; pitch = tp;
        tzoom = zoom = 1;
        apply();
      } else if (!o.reducedMotion) {
        /* 机位切换：从当前位置「推」过去，时长按距离伸缩，缓入缓出 */
        var dist = pos.distanceTo(target);
        trans = {
          t: 0,
          dur: Math.min(2.4, Math.max(1.15, dist * 0.17)),
          fromPos: pos.clone(),
          toPos: target.clone(),
          fromYaw: yaw,
          dYaw: shortAngle(yaw, ty),
          fromPitch: pitch,
          dPitch: tp - pitch,
          fromZoom: zoom,
          dZoom: 1 - zoom
        };
      } else {
        trans = null;
        pos.copy(target); yaw = ty; pitch = tp; tzoom = zoom = 1;
      }
      if (walking) canvas.focus({ preventScroll: true });
    }

    var obstacles = [[-2.6, -4.2, 1.2], [0.4, -2.2, 1.0], [7.2, -5.4, 0.9], [1.5, -8.4, 0.5], [5.3, -8.4, 0.5]];
    for (var i = 0; i < 4; i++) { var a = Math.PI / 4 + i * Math.PI / 2; obstacles.push([0.4 + Math.cos(a) * 1.35, -2.2 + Math.sin(a) * 1.35, 0.5]); }

    function safe(x, z) {
      return x >= -8.7 && x <= 8.7 && z >= -8 && z <= 7.5
        && !(x > -5.25 && x < 0.05 && z > -6.65 && z < -1.75)
        && !obstacles.some(function (p) { return Math.hypot(x - p[0], z - p[1]) < p[2]; });
    }

    function move(s, f, d) {
      var dx = (Math.cos(yaw) * s + Math.sin(yaw) * f) * d;
      var dz = (Math.sin(yaw) * s - Math.cos(yaw) * f) * d;
      var steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.1));
      for (var j = 0; j < steps; j++) {
        if (safe(pos.x + dx / steps, pos.z)) { pos.x += dx / steps; target.x += dx / steps; }
        if (safe(pos.x, pos.z + dz / steps)) { pos.z += dz / steps; target.z += dz / steps; }
      }
    }

    function blocked() {
      return !enabled || document.hidden
        || !!document.querySelector('.agent.on, .modal.on')
        || section.getBoundingClientRect().bottom <= 60;
    }

    function step(dir, d) {
      move(dir === 'right' ? 1 : dir === 'left' ? -1 : 0,
        dir === 'forward' ? 1 : dir === 'back' ? -1 : 0, d);
    }

    function pick(x, y) {
      var r = canvas.getBoundingClientRect();
      ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
      ray.setFromCamera(ndc, camera);
      var hits = ray.intersectObjects(targets.map(function (t) { return t.object; }), false);
      return hits.length ? targets.find(function (t) { return t.object === hits[0].object; }) : null;
    }

    /* ---------------- 输入 ---------------- */
    on(canvas, 'pointerdown', function (e) {
      if (!enabled || e.button !== 0) return;
      canvas.focus({ preventScroll: true });
      clear(); dragging = true; moved = false;
      sx = lx = e.clientX; sy = ly = e.clientY;
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add('grabbing');
    });
    on(canvas, 'pointermove', function (e) {
      if (!enabled) return;
      if (dragging) {
        if (Math.hypot(e.clientX - sx, e.clientY - sy) > 5) moved = true;
        ty -= (e.clientX - lx) * 0.004;
        tp = Math.max(-0.65, Math.min(1.12, tp + (e.clientY - ly) * 0.003));
        lx = e.clientX; ly = e.clientY;
      } else {
        var t = pick(e.clientX, e.clientY);
        canvas.style.cursor = t ? 'pointer' : 'grab';
        if (cb.onHover) cb.onHover(t);
      }
    });
    on(canvas, 'pointerup', function (e) {
      var click = dragging && !moved;
      clear();
      if (click && enabled) { var t = pick(e.clientX, e.clientY); if (t && cb.onSelect) cb.onSelect(t); }
    });
    on(canvas, 'pointercancel', clear);
    on(window, 'blur', clear);
    on(document, 'visibilitychange', clear);

    /* 滚轮缩放：在缩放区间内接管滚轮；到达极限后交还页面滚动 */
    on(canvas, 'wheel', function (e) {
      if (!enabled) return;
      var towardIn = e.deltaY < 0;   // 上滚 → 放大
      var towardOut = e.deltaY > 0;  // 下滚 → 缩小
      var atMax = tzoom >= ZMAX - 1e-4;
      var atMin = tzoom <= ZMIN + 1e-4;
      if ((towardIn && !atMax) || (towardOut && !atMin)) {
        e.preventDefault();
        var stepZ = Math.min(0.18, Math.abs(e.deltaY) * 0.0018 + 0.06);
        tzoom = Math.max(ZMIN, Math.min(ZMAX, tzoom + (towardIn ? stepZ : -stepZ)));
        if (cb.onZoom) cb.onZoom(tzoom);
      }
      /* 到极限：不 preventDefault，页面正常滚动 */
    }, { passive: false });

    on(document, 'keydown', function (e) {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      if (e.code === 'Escape' && walking && !document.querySelector('.agent.on, .modal.on')) { view('overview'); return; }
      if (blocked() || !section.contains(e.target)) return;
      if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(e.code)) { e.preventDefault(); keys[e.code] = true; }
    });
    on(document, 'keyup', function (e) { delete keys[e.code]; });

    section.querySelectorAll('[data-view]').forEach(function (b) {
      on(b, 'click', function () { view(b.dataset.view); });
    });
    section.querySelectorAll('[data-move]').forEach(function (b) {
      on(b, 'pointerdown', function (e) {
        if (blocked()) return;
        held = b.dataset.move; heldAt = performance.now();
        b.setPointerCapture(e.pointerId);
      });
      on(b, 'pointerup', function () { if (held && performance.now() - heldAt < 180) step(b.dataset.move, 0.45); held = null; });
      on(b, 'pointercancel', function () { held = null; });
      on(b, 'click', function (e) { if (!e.detail && !blocked()) step(b.dataset.move, 0.65); });
    });

    view('overview', true);

    return {
      update: function (dt) {
        if (disposed) return;
        dt = Math.min(Math.max(dt || 0, 0), 0.05);

        /* 行走 */
        if (!blocked() && (walking || keys.KeyW || keys.KeyS || keys.KeyA || keys.KeyD
          || keys.ArrowUp || keys.ArrowDown || keys.ArrowLeft || keys.ArrowRight)) {
          var f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
          var s = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
          var n = Math.hypot(s, f) || 1;
          if (s || f) move(s / n, f / n, dt * 2.4);
          if (held) step(held, dt * 2.4);
        } else { keys = {}; held = null; }

        /* 机位过渡阻尼：reducedMotion 直接到位，常规约 0.9s 完成 */
        /* 用户一操作就接管，打断过渡 */
        if (trans && (dragging || keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']
          || keys['ArrowUp'] || keys['ArrowDown'] || keys['ArrowLeft'] || keys['ArrowRight'])) {
          trans = null;
        }

        if (trans) {
          trans.t += dt;
          var k = Math.min(1, trans.t / trans.dur);
          var e = easeInOutCubic(k);
          pos.lerpVectors(trans.fromPos, trans.toPos, e);
          yaw = trans.fromYaw + trans.dYaw * e;
          pitch = trans.fromPitch + trans.dPitch * e;
          zoom = trans.fromZoom + trans.dZoom * e;
          tzoom = 1;
          if (k >= 1) {
            trans = null;
            pos.copy(target);
            yaw = ty; pitch = tp;
            zoom = tzoom = 1;
          }
        } else {
          var damp = o.reducedMotion ? 1 : 1 - Math.exp(-9 * dt);
          pos.lerp(target, damp);
          yaw += (ty - yaw) * damp;
          pitch += (tp - pitch) * damp;
          zoom += (tzoom - zoom) * damp;
        }
        apply();

        canvas.dataset.position = [pos.x, pos.y, pos.z].map(function (v) { return v.toFixed(2); }).join(',');
      },
      goTo: view,
      isTransitioning: function () { return !!trans; },
      reset: function () { view('overview'); },
      setEnabled: function (v) { enabled = !!v; clear(); },
      setTargets: function (v) { targets = v || []; },
      zoomTo: function (z) { tzoom = Math.max(ZMIN, Math.min(ZMAX, z)); },
      getZoom: function () { return zoom; },
      setProgress: function () {},
      getProgress: function () { return 0; },
      get phase() { return walking ? 'walk' : 'overview'; },
      dispose: function () {
        disposed = true; clear();
        listeners.forEach(function (f) { f(); });
      }
    };
  };
})();
