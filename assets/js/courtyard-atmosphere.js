/* =====================================================================
 * courtyard-atmosphere.js —— M03 灯光 / 材质 / 薄雾 / 浮尘 / 质量档位
 * ---------------------------------------------------------------------
 * 契约（02_模块接口与集成约定.md §2）：
 *   window.NIANLUN_MODULES.createAtmosphere({
 *     THREE, scene, renderer, anchors, materialSlots, quality, reducedMotion
 *   }) -> { update(dt), setQuality(level), renderFrame|null, dispose() }
 *
 * 灰盒阶段说明（M02 的院内模型未交付前）：
 *   · 不传 anchors / materialSlots 时，本模块自动在 scene 中发现
 *     主投影平行光（castShadow 的 DirectionalLight）、天光（HemisphereLight）、
 *     轮廓光（另一盏 DirectionalLight）与环境光，仅在这四个约定槽位上调参，
 *     不创建/删除场景模型，不新增投影光源。
 *   · renderFrame 恒为 null：当前 r160 全局构建未附带后处理插件，
 *     按契约§5不与 ESM 插件混用，UnrealBloomPass 留待 M00 决定同版方案
 *     （见交付 README「剩余问题」）。首版为直接渲染，宿主继续用
 *     renderer.render(scene, camera)。
 *
 * 调试参数（URL）：
 *   ?quality=low|medium|high   强制质量档位（默认：窄屏 low，其余 high）
 *   ?perf=1                    在画面左上角显示帧率 / 帧时间 / draw calls
 *   宿主侧另有 ?camfix=az,el,dist（固定机位）与 ?atmo=off（关闭本模块）。
 * ===================================================================== */
(function () {
  'use strict';

  window.NIANLUN_MODULES = window.NIANLUN_MODULES || {};

  /* ---------------- 氛围预设：清晨斜光 ---------------- */
  var PRESET = {
    name: 'morning-courtyard（清晨斜光）',
    exposure: 1.12,
    fog: { color: 0xb8d1df, near: 42, far: 140 },     // 薄而克制的暖雾，按院内尺度（主景 ≤40m）标定
    key: { color: 0xffd2a0, intensity: 2.55, elevation: 16, azimuth: 12, dist: 44 }, // 自东偏南低角度，拉长树影
    hemi: { sky: 0xcfe0ee, ground: 0x5f4c33, intensity: 1.0 },  // 冷天光降温，暖地面反弹
    rim: { color: 0xaec6e4, intensity: 0.42 },
    ambient: 0.24,
    shadow: { extent: 17, bias: -0.00045, normalBias: 0.03 },    // 视锥收紧到院内主体，提升有效精度
    dust: {
      opacity: 0.45, size: 0.12, color: 0xfff3da,
      // 浮尘限定在古枣树周边的斜光通道内（树位由宿主模型决定，灰盒期硬编码院心偏北）
      center: [-2.6, 3.2, -4.2], half: [5.0, 3.0, 4.0]
    },
    glow: { color: 0xffe6b8, opacity: 0.5, scale: 26, dist: 160 }
  };

  var QUALITY = {
    low: { shadowMap: 1024, dust: 0, glow: false },
    medium: { shadowMap: 2048, dust: 70, glow: true },
    high: { shadowMap: 2048, dust: 130, glow: true }
  };

  /* 模块自有种子（与 tree3d.js 的种子互不影响，保证两套都可复现） */
  var _seed = 20261019 ^ 0x4d3033; // 'M03'
  function rnd() {
    _seed |= 0; _seed = (_seed + 0x6D2B79F5) | 0;
    var t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function makeSoftDotTexture(THREE) {
    var c = document.createElement('canvas');
    c.width = c.height = 64;
    var g = c.getContext('2d');
    var grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    var tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  window.NIANLUN_MODULES.createAtmosphere = function (opts) {
    var THREE = opts.THREE;
    var scene = opts.scene;
    var renderer = opts.renderer;
    var reducedMotion = !!opts.reducedMotion;
    var P = PRESET;

    /* ---------------- 槽位自动发现（灰盒路径） ---------------- */
    var key = null, rim = null, hemi = null, amb = null;
    scene.traverse(function (o) {
      if (o.isDirectionalLight && o.castShadow && !key) key = o;
      else if (o.isDirectionalLight && !o.castShadow && !rim) rim = o;
      else if (o.isHemisphereLight && !hemi) hemi = o;
      else if (o.isAmbientLight && !amb) amb = o;
    });

    /* ---------------- 原始状态快照（dispose 时恢复） ---------------- */
    var origin = {
      exposure: renderer.toneMappingExposure,
      fog: scene.fog ? { color: scene.fog.color.getHex(), near: scene.fog.near, far: scene.fog.far } : null,
      key: key ? {
        color: key.color.getHex(), intensity: key.intensity,
        pos: key.position.clone(), mapSize: key.shadow.mapSize.x,
        extent: key.shadow.camera.right, bias: key.shadow.bias, normalBias: key.shadow.normalBias
      } : null,
      hemi: hemi ? { sky: hemi.color.getHex(), ground: hemi.groundColor.getHex(), intensity: hemi.intensity } : null,
      rim: rim ? { color: rim.color.getHex(), intensity: rim.intensity } : null,
      amb: amb ? { intensity: amb.intensity } : null
    };

    /* ---------------- 应用预设 ---------------- */
    renderer.toneMappingExposure = P.exposure;

    if (scene.fog && scene.fog.isFog) {
      scene.fog.color.setHex(P.fog.color);
      scene.fog.near = P.fog.near;
      scene.fog.far = P.fog.far;
    }

    if (key) {
      var elRad = P.key.elevation * Math.PI / 180;
      var azRad = P.key.azimuth * Math.PI / 180;
      var target = key.target ? key.target.position : new THREE.Vector3();
      key.color.setHex(P.key.color);
      key.intensity = P.key.intensity;
      key.position.set(
        target.x + Math.cos(azRad) * Math.cos(elRad) * P.key.dist,
        target.y + Math.sin(elRad) * P.key.dist,
        target.z + Math.sin(azRad) * Math.cos(elRad) * P.key.dist
      );
      var SH = P.shadow.extent;
      key.shadow.camera.left = -SH; key.shadow.camera.right = SH;
      key.shadow.camera.top = SH; key.shadow.camera.bottom = -SH;
      key.shadow.camera.updateProjectionMatrix();
      key.shadow.bias = P.shadow.bias;
      key.shadow.normalBias = P.shadow.normalBias;
    }
    if (hemi) {
      hemi.color.setHex(P.hemi.sky);
      hemi.groundColor.setHex(P.hemi.ground);
      hemi.intensity = P.hemi.intensity;
    }
    if (rim) {
      rim.color.setHex(P.rim.color);
      rim.intensity = P.rim.intensity;
    }
    if (amb) amb.intensity = P.ambient;

    /* ---------------- 浮尘：单个 Points 系统 ---------------- */
    var own = [];               // 本模块创建、负责销毁的对象
    var dust = null, dustBase = null, dustPhase = null;
    var dotTex = makeSoftDotTexture(THREE);

    function buildDust(maxCount) {
      var pos = new Float32Array(maxCount * 3);
      dustBase = new Float32Array(maxCount * 3);
      dustPhase = new Float32Array(maxCount);
      var c = P.dust.center, h = P.dust.half;
      for (var i = 0; i < maxCount; i++) {
        var x = c[0] + (rnd() * 2 - 1) * h[0];
        var y = Math.max(0.35, c[1] + (rnd() * 2 - 1) * h[1]);
        var z = c[2] + (rnd() * 2 - 1) * h[2];
        dustBase[i * 3] = x; dustBase[i * 3 + 1] = y; dustBase[i * 3 + 2] = z;
        pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
        dustPhase[i] = rnd() * Math.PI * 2;
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      var mat = new THREE.PointsMaterial({
        map: dotTex, color: P.dust.color, size: P.dust.size, sizeAttenuation: true,
        transparent: true, opacity: P.dust.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false
      });
      dust = new THREE.Points(geo, mat);
      dust.frustumCulled = true;
      dust.visible = false;
      scene.add(dust);
      own.push(dust);
    }
    buildDust(QUALITY.high.dust);

    /* ---------------- 日光辉光（轻量 Sprite，非体积光） ---------------- */
    var glow = null;
    var glowTex = makeSoftDotTexture(THREE);
    if (key) {
      var gmat = new THREE.SpriteMaterial({
        map: glowTex, color: P.glow.color, transparent: true, opacity: P.glow.opacity,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false
      });
      glow = new THREE.Sprite(gmat);
      var dir = key.position.clone().sub(key.target ? key.target.position : new THREE.Vector3()).normalize();
      glow.position.copy(dir.multiplyScalar(P.glow.dist));
      if (key.target) glow.position.add(key.target.position);
      glow.scale.set(P.glow.scale, P.glow.scale, 1);
      glow.visible = false;
      scene.add(glow);
      own.push(glow);
    }

    /* ---------------- 质量档位 ---------------- */
    var level = 'high';
    function setQuality(l) {
      if (!QUALITY[l]) l = 'high';
      level = l;
      var q = QUALITY[l];
      if (key && key.shadow.mapSize.x !== q.shadowMap) {
        key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
        if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
      }
      if (dust) {
        dust.geometry.setDrawRange(0, Math.min(q.dust, QUALITY.high.dust));
        dust.visible = q.dust > 0 && !reducedMotion;
      }
      if (glow) glow.visible = q.glow;
    }
    setQuality(opts.quality || 'high');

    /* ---------------- 性能探针（?perf=1 时由宿主开启） ---------------- */
    var perfEl = null, perfAcc = 0, perfFrames = 0, perfWorst = 0;
    if (opts.perfHud && typeof document !== 'undefined') {
      perfEl = document.createElement('div');
      perfEl.id = 'atmoPerf';
      perfEl.style.cssText = 'position:fixed;left:10px;top:64px;z-index:300;background:rgba(0,0,0,.55);' +
        'color:#fff;font:12px/1.5 monospace;padding:4px 8px;border-radius:3px;pointer-events:none';
      document.body.appendChild(perfEl);
    }

    /* ---------------- 帧更新 ---------------- */
    var t = 0;
    function update(dt) {
      t += dt;
      if (dust && dust.visible) {
        var arr = dust.geometry.attributes.position.array;
        var n = Math.min(QUALITY[level].dust, QUALITY.high.dust);
        for (var i = 0; i < n; i++) {
          arr[i * 3] = dustBase[i * 3] + Math.sin(t * 0.07 + dustPhase[i] * 1.7) * 0.4;
          arr[i * 3 + 1] = dustBase[i * 3 + 1] + Math.sin(t * 0.11 + dustPhase[i]) * 0.3;
        }
        dust.geometry.attributes.position.needsUpdate = true;
      }
      if (perfEl) {
        perfAcc += dt; perfFrames++;
        if (dt * 1000 > perfWorst) perfWorst = dt * 1000;
        if (perfAcc >= 0.5) {
          var fps = perfFrames / perfAcc;
          perfEl.textContent = 'fps ' + fps.toFixed(0) +
            ' · 帧均 ' + (perfAcc * 1000 / perfFrames).toFixed(1) + 'ms' +
            ' · 最差 ' + perfWorst.toFixed(1) + 'ms' +
            ' · calls ' + renderer.info.render.calls +
            ' · tris ' + (renderer.info.render.triangles / 1000).toFixed(0) + 'k' +
            ' · ' + level;
          perfAcc = 0; perfFrames = 0; perfWorst = 0;
        }
      }
    }

    /* ---------------- 销毁：释放自有资源并恢复宿主原状 ---------------- */
    function dispose() {
      for (var i = 0; i < own.length; i++) {
        scene.remove(own[i]);
        if (own[i].geometry) own[i].geometry.dispose();
        if (own[i].material) own[i].material.dispose();
      }
      dotTex.dispose();
      glowTex.dispose();
      renderer.toneMappingExposure = origin.exposure;
      if (origin.fog && scene.fog) {
        scene.fog.color.setHex(origin.fog.color);
        scene.fog.near = origin.fog.near;
        scene.fog.far = origin.fog.far;
      }
      if (origin.key && key) {
        key.color.setHex(origin.key.color);
        key.intensity = origin.key.intensity;
        key.position.copy(origin.key.pos);
        key.shadow.bias = origin.key.bias;
        key.shadow.normalBias = origin.key.normalBias;
        var e = origin.key.extent;
        key.shadow.camera.left = -e; key.shadow.camera.right = e;
        key.shadow.camera.top = e; key.shadow.camera.bottom = -e;
        key.shadow.camera.updateProjectionMatrix();
        if (key.shadow.mapSize.x !== origin.key.mapSize) {
          key.shadow.mapSize.set(origin.key.mapSize, origin.key.mapSize);
          if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
        }
      }
      if (origin.hemi && hemi) {
        hemi.color.setHex(origin.hemi.sky);
        hemi.groundColor.setHex(origin.hemi.ground);
        hemi.intensity = origin.hemi.intensity;
      }
      if (origin.rim && rim) {
        rim.color.setHex(origin.rim.color);
        rim.intensity = origin.rim.intensity;
      }
      if (origin.amb && amb) amb.intensity = origin.amb.intensity;
      if (perfEl && perfEl.parentNode) perfEl.parentNode.removeChild(perfEl);
    }

    return {
      update: update,
      setQuality: setQuality,
      renderFrame: null,   // 灰盒期无后处理；宿主继续直接 render（见文件头说明）
      dispose: dispose,
      preset: P.name,
      get quality() { return level; }
    };
  };
})();
