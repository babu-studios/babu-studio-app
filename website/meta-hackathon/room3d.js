// Meta AI Hackathon Room: a full 3D room section — team tables, solo desks,
// teammates typing on glowing laptops, wall sign and whiteboard.
//
// Sections: boot guards | renderer/scene/camera/lights | canvas textures |
// builders + layout | controls + presets | main loop.
//
// Fails silent: if the three.js CDN or WebGL is unavailable the section
// shows a fallback note. Honors prefers-reduced-motion (static + draggable).
async function loadThree() {
  const sources = [
    "three",
    "./vendor/three.module.js",
    "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js",
    "https://unpkg.com/three@0.160.0/build/three.module.js",
  ];
  for (const src of sources) {
    try {
      const mod = await import(src);
      if (mod && mod.WebGLRenderer) {
        return mod;
      }
    } catch {
      /* try the next source */
    }
  }
  return null;
}
const THREE = await loadThree();

const canvas = document.getElementById("room-canvas");
const wrap = document.getElementById("room-wrap");
const fallback = document.getElementById("room-fallback");
const controlsEl = document.getElementById("room-controls");

function showFallback(reason) {
  if (canvas) {
    canvas.style.display = "none";
  }
  if (controlsEl) {
    controlsEl.style.display = "none";
  }
  if (fallback) {
    fallback.hidden = false;
    if (reason) {
      const msg = fallback.querySelector("[data-room-msg]");
      if (msg) {
        msg.textContent = reason;
      }
    }
  }
}

const retryBtn = document.getElementById("room-retry");
if (retryBtn) {
  retryBtn.addEventListener("click", () => window.location.reload());
}

if (!THREE) {
  console.warn("[room] three.js failed to load from every source; showing fallback.");
  showFallback("Could not load the three.js library — check your connection and try again.");
} else if (!canvas || !wrap) {
  showFallback();
} else {
  try {
    start(THREE);
  } catch (err) {
    console.warn("[room] failed to start:", err);
    showFallback(`Could not start the 3D room (${err && err.message ? err.message : "unknown error"}). Try again or use another browser.`);
  }
}

function start(THREE) {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // -- Renderer / scene / camera -------------------------------------------
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  } catch {
    console.warn("[room] WebGL unavailable; showing fallback.");
    showFallback("WebGL is unavailable in this browser — enable hardware acceleration and try again.");
    return;
  }
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    showFallback("The 3D view lost its graphics context — try again.");
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 200);

  const hemi = new THREE.HemisphereLight(0xd8e6ee, 0x1d2422, 0.75);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
  sun.position.set(10, 14, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -16;
  sun.shadow.camera.right = 16;
  sun.shadow.camera.top = 14;
  sun.shadow.camera.bottom = -14;
  sun.shadow.camera.far = 45;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  for (const [px, pz] of [[-8.5, -4], [-3, 0.5]]) {
    const lamp = new THREE.PointLight(0xffd9a0, 30, 22, 2);
    lamp.position.set(px, 4.0, pz);
    scene.add(lamp);
  }

  // -- Canvas textures (floor, sign, whiteboard, posters, code) -------------
  function canvasTex(w, h, draw, srgb = true) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const tex = new THREE.CanvasTexture(c);
    if (srgb) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    tex.anisotropy = maxAniso;
    return tex;
  }

  const floorTex = canvasTex(512, 512, (g) => {
    const browns = ["#6b4a2f", "#755334", "#63452c", "#7d5a3a"];
    for (let row = 0; row < 8; row++) {
      g.fillStyle = browns[row % browns.length];
      g.fillRect(0, row * 64, 512, 64);
      g.strokeStyle = "rgba(30,18,8,0.35)";
      g.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const y = row * 64 + 6 + i * 7;
        g.beginPath();
        g.moveTo(0, y);
        g.bezierCurveTo(170, y + 3, 340, y - 3, 512, y + 2);
        g.stroke();
      }
      g.fillStyle = "#1c130c";
      g.fillRect(0, row * 64 + 62, 512, 2);
      g.fillRect((row * 197) % 512, row * 64, 2, 62);
    }
  });
  floorTex.wrapS = THREE.RepeatWrapping;
  floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(4, 3);

  const signTex = canvasTex(1408, 256, (g) => {
    const bg = g.createLinearGradient(0, 0, 1408, 0);
    bg.addColorStop(0, "#0a1628");
    bg.addColorStop(1, "#0d1f3c");
    g.fillStyle = bg;
    g.fillRect(0, 0, 1408, 256);
    // Meta-style loop: a gradient lemniscate.
    g.save();
    g.translate(170, 128);
    const grad = g.createLinearGradient(-110, 0, 110, 0);
    grad.addColorStop(0, "#0082fb");
    grad.addColorStop(1, "#00d2ff");
    g.strokeStyle = grad;
    g.lineWidth = 22;
    g.lineCap = "round";
    g.shadowColor = "rgba(0,150,255,0.55)";
    g.shadowBlur = 26;
    g.beginPath();
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      const d = 1 + Math.sin(t) * Math.sin(t);
      const px = (Math.cos(t) / d) * 105;
      const py = (Math.sin(t) * Math.cos(t) / d) * 105;
      if (i === 0) {
        g.moveTo(px, py);
      } else {
        g.lineTo(px, py);
      }
    }
    g.closePath();
    g.stroke();
    g.restore();
    g.fillStyle = "#f2f7ff";
    g.font = "700 68px -apple-system, 'Segoe UI', system-ui, sans-serif";
    g.textBaseline = "middle";
    g.fillText("META AI HACKATHON ROOM", 320, 108);
    g.fillStyle = "#7ee2a8";
    g.font = "600 34px -apple-system, 'Segoe UI', system-ui, sans-serif";
    g.fillText("BUILD  •  DEMO  •  SHIP", 322, 182);
  });

  const boardTex = canvasTex(512, 320, (g) => {
    g.fillStyle = "#eef1f4";
    g.fillRect(0, 0, 512, 320);
    g.fillStyle = "#1a56db";
    g.font = "700 44px -apple-system, 'Segoe UI', sans-serif";
    g.fillText("DEMO DAY", 28, 62);
    g.strokeStyle = "#e02424";
    g.lineWidth = 5;
    g.beginPath();
    g.ellipse(390, 52, 92, 34, -0.08, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = "#1a56db";
    g.font = "700 30px -apple-system, 'Segoe UI', sans-serif";
    g.fillText("demo @ 6pm", 300, 56);
    const rows = ["highlights cut", "subs × 78", "rehearse", "ship it"];
    rows.forEach((row, i) => {
      const y = 118 + i * 50;
      g.strokeStyle = "#2f9e44";
      g.lineWidth = 6;
      g.lineCap = "round";
      g.beginPath();
      g.moveTo(34, y);
      g.lineTo(48, y + 12);
      g.lineTo(72, y - 12);
      g.stroke();
      g.fillStyle = "#333c44";
      g.font = "600 27px -apple-system, 'Segoe UI', sans-serif";
      g.fillText(row, 92, y + 8);
    });
    g.strokeStyle = "#e8890c";
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(330, 250);
    g.lineTo(460, 250);
    g.lineTo(440, 236);
    g.moveTo(460, 250);
    g.lineTo(440, 264);
    g.stroke();
  });

  function posterTex(word, accent) {
    return canvasTex(256, 340, (g) => {
      g.fillStyle = "#10181d";
      g.fillRect(0, 0, 256, 340);
      g.fillStyle = accent;
      g.fillRect(0, 0, 256, 26);
      g.fillRect(0, 314, 256, 26);
      g.fillStyle = "#f2f7ff";
      g.font = "800 62px -apple-system, 'Segoe UI', sans-serif";
      g.textAlign = "center";
      const parts = word.split(" ");
      parts.forEach((part, i) => {
        g.fillText(part, 128, 148 + i * 66);
      });
      g.fillStyle = accent;
      g.font = "600 20px -apple-system, 'Segoe UI', sans-serif";
      g.fillText("META AI HACKATHON", 128, 292);
    });
  }

  function codeTex(variant) {
    return canvasTex(256, 160, (g) => {
      g.fillStyle = "#0d1117";
      g.fillRect(0, 0, 256, 160);
      g.fillStyle = "#161b22";
      g.fillRect(0, 0, 256, 16);
      ["#ff5f57", "#febc2e", "#28c840"].forEach((dot, i) => {
        g.fillStyle = dot;
        g.beginPath();
        g.arc(12 + i * 12, 8, 4, 0, Math.PI * 2);
        g.fill();
      });
      const palette = ["#7ee787", "#79c0ff", "#ffa657", "#d2a8ff", "#56d4dd"];
      for (let row = 0; row < 9; row++) {
        let x = 12 + ((row * 53 + variant * 29) % 40);
        const y = 28 + row * 14;
        let k = 0;
        while (x < 236) {
          const w = 18 + ((row * 37 + k * 23 + variant * 11) % 62);
          g.fillStyle = palette[(row + k + variant) % palette.length];
          if (g.roundRect) {
            g.beginPath();
            g.roundRect(x, y, Math.min(w, 244 - x), 7, 3);
            g.fill();
          } else {
            g.fillRect(x, y, Math.min(w, 244 - x), 7);
          }
          x += w + 8;
          k += 1;
        }
      }
    });
  }

  // -- Shared materials + geometry cache --------------------------------------
  const M = {
    floor: new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9 }),
    wall: new THREE.MeshStandardMaterial({ color: 0x2a3230, roughness: 1 }),
    rug: new THREE.MeshStandardMaterial({ color: 0x0f3f3c, roughness: 1 }),
    tableTop: new THREE.MeshStandardMaterial({ color: 0x8a6742, roughness: 0.7 }),
    tableLeg: new THREE.MeshStandardMaterial({ color: 0x3a3f3d, roughness: 0.6, metalness: 0.4 }),
    chairFrame: new THREE.MeshStandardMaterial({ color: 0x2b3231, roughness: 0.6, metalness: 0.3 }),
    laptopShell: new THREE.MeshStandardMaterial({ color: 0x1c2126, roughness: 0.5 }),
    cup: new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.6 }),
    cord: new THREE.MeshStandardMaterial({ color: 0x14181b, roughness: 0.9 }),
    shade: new THREE.MeshStandardMaterial({ color: 0x1f5c38, roughness: 0.6, side: THREE.DoubleSide }),
    bulb: new THREE.MeshBasicMaterial({ color: 0xffe3b0, toneMapped: false }),
    board: new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.9 }),
    sign: new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }),
  };
  const codeMaps = [codeTex(0), codeTex(1)];
  function screenMat(i) {
    return new THREE.MeshBasicMaterial({ map: codeMaps[i % 2], toneMapped: false });
  }
  const SKIN = [0xf1c9a5, 0xc68863, 0x8d5524, 0xffdbb4, 0x6b4423];
  const SHIRT = [0x2f6fed, 0xe05d5d, 0x3fa66a, 0xe8a13c, 0x8a63d2, 0x3fb3d4];
  const HAIR = [0x1c1c1e, 0x4a3228, 0x777777, 0xd9c07a, 0x333333];
  const SEAT = [0x37514c, 0x54423a, 0x3a4a5c, 0x5c3a4a];

  const geoCache = new Map();
  function boxGeo(w, h, d) {
    const k = `b${w},${h},${d}`;
    if (!geoCache.has(k)) {
      geoCache.set(k, new THREE.BoxGeometry(w, h, d));
    }
    return geoCache.get(k);
  }
  function cylGeo(rt, rb, h, seg = 12) {
    const k = `c${rt},${rb},${h},${seg}`;
    if (!geoCache.has(k)) {
      geoCache.set(k, new THREE.CylinderGeometry(rt, rb, h, seg));
    }
    return geoCache.get(k);
  }
  function sphGeo(r, w = 16, h = 12) {
    const k = `s${r},${w},${h}`;
    if (!geoCache.has(k)) {
      geoCache.set(k, new THREE.SphereGeometry(r, w, h));
    }
    return geoCache.get(k);
  }
  const matCache = new Map();
  function flatMat(color, roughness = 0.8) {
    const k = `${color}/${roughness}`;
    if (!matCache.has(k)) {
      matCache.set(k, new THREE.MeshStandardMaterial({ color, roughness }));
    }
    return matCache.get(k);
  }
  function put(parent, mesh, cast = true) {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function box(parent, mat, w, h, d, x, y, z) {
    const m = new THREE.Mesh(boxGeo(w, h, d), mat);
    m.position.set(x, y, z);
    return put(parent, m);
  }
  function cyl(parent, mat, rt, rb, h, x, y, z, seg = 12) {
    const m = new THREE.Mesh(cylGeo(rt, rb, h, seg), mat);
    m.position.set(x, y, z);
    return put(parent, m);
  }
  function sph(parent, mat, r, x, y, z, w = 16, h = 12) {
    const m = new THREE.Mesh(sphGeo(r, w, h), mat);
    m.position.set(x, y, z);
    return put(parent, m);
  }

  // -- Room shell --------------------------------------------------------------
  const room = new THREE.Group();
  scene.add(room);
  {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(26, 18), M.floor);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    room.add(floor);
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(26, 7), M.wall);
    backWall.position.set(0, 3.5, -9);
    backWall.receiveShadow = true;
    room.add(backWall);
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(18, 7), M.wall);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-13, 3.5, 0);
    leftWall.receiveShadow = true;
    room.add(leftWall);
    const rug = new THREE.Mesh(new THREE.PlaneGeometry(15, 10), M.rug);
    rug.rotation.x = -Math.PI / 2;
    rug.position.set(-5.25, 0.012, -1.75);
    rug.receiveShadow = true;
    room.add(rug);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(13, 2.375), M.sign);
    sign.position.set(-1, 5.0, -8.92);
    room.add(sign);
    box(room, M.tableLeg, 3.8, 2.4, 0.06, 7.5, 2.7, -8.96);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 2.2), M.board);
    board.position.set(7.5, 2.7, -8.92);
    room.add(board);
    const posterMatA = new THREE.MeshStandardMaterial({ map: posterTex("HACK", "#35c759"), roughness: 0.9 });
    const posterA = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.9), posterMatA);
    posterA.rotation.y = Math.PI / 2;
    posterA.position.set(-12.92, 3.4, -4);
    room.add(posterA);
    const posterMatB = new THREE.MeshStandardMaterial({ map: posterTex("SHIP IT", "#38b6ff"), roughness: 0.9 });
    const posterB = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.9), posterMatB);
    posterB.rotation.y = Math.PI / 2;
    posterB.position.set(-12.92, 3.4, 0.5);
    room.add(posterB);
  }

  function pendant(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    cyl(g, M.cord, 0.02, 0.02, 2.6, 0, 5.7, 0, 8);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.5, 20, 1, true), M.shade);
    shade.position.y = 4.3;
    put(g, shade);
    const bulb = new THREE.Mesh(sphGeo(0.12, 12, 10), M.bulb);
    bulb.position.y = 4.12;
    put(g, bulb, false);
    room.add(g);
  }

  // -- Furniture -----------------------------------------------------------------
  function roundTable(x, z, r, topY) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    cyl(g, M.tableTop, r, r, 0.08, 0, topY - 0.04, 0, 28);
    cyl(g, M.tableLeg, 0.14, 0.14, topY - 0.08, 0, (topY - 0.08) / 2, 0, 12);
    cyl(g, M.tableLeg, 0.5, 0.55, 0.06, 0, 0.03, 0, 20);
    room.add(g);
  }

  function chair(x, z, rotY, seatMat) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    box(g, seatMat, 0.46, 0.06, 0.46, 0, 0.46, 0);
    const back = box(g, seatMat, 0.46, 0.55, 0.06, 0, 0.78, -0.22);
    back.rotation.x = 0.08;
    cyl(g, M.chairFrame, 0.03, 0.03, 0.44, 0, 0.23, 0, 10);
    cyl(g, M.chairFrame, 0.26, 0.28, 0.04, 0, 0.03, 0, 16);
    room.add(g);
  }

  const people = [];
  function person(x, z, rotY, idx) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = rotY;
    const skin = flatMat(SKIN[idx % SKIN.length], 0.6);
    const shirt = flatMat(SHIRT[idx % SHIRT.length], 0.85);
    const hairM = flatMat(HAIR[idx % HAIR.length], 0.9);
    const torsoG = new THREE.Group();
    torsoG.position.y = 0.62;
    g.add(torsoG);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.34, 6, 12), shirt);
    torso.position.y = 0.16;
    torso.rotation.x = 0.1;
    put(torsoG, torso);
    const headG = new THREE.Group();
    headG.position.set(0, 0.5, 0.04);
    torsoG.add(headG);
    sph(headG, skin, 0.14, 0, 0.1, 0.02, 18, 14);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.148, 18, 12, 0, Math.PI * 2, 0, 1.9), hairM,
    );
    hair.position.set(0, 0.115, -0.01);
    hair.rotation.x = -0.35;
    put(headG, hair);
    const arms = [];
    for (const s of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.2, 0.32, 0.06);
      sh.rotation.x = -1.35;
      torsoG.add(sh);
      const upper = new THREE.Mesh(cylGeo(0.045, 0.04, 0.3, 8), shirt);
      upper.position.y = -0.15;
      put(sh, upper);
      const el = new THREE.Group();
      el.position.y = -0.3;
      el.rotation.x = -0.25;
      sh.add(el);
      const fore = new THREE.Mesh(cylGeo(0.038, 0.034, 0.3, 8), skin);
      fore.position.y = -0.15;
      put(el, fore);
      arms.push({ sh, el });
    }
    room.add(g);
    people.push({ torsoG, headG, arms, phase: idx * 1.7 });
  }

  let laptopCount = 0;
  function laptop(x, z, rotY, tableY) {
    const g = new THREE.Group();
    g.position.set(x, tableY, z);
    g.rotation.y = rotY;
    box(g, M.laptopShell, 0.36, 0.025, 0.24, 0, 0.013, 0);
    const lid = new THREE.Group();
    lid.position.set(0, 0.025, -0.11);
    lid.rotation.x = -0.28;
    g.add(lid);
    box(lid, M.laptopShell, 0.36, 0.24, 0.015, 0, 0.12, 0);
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.2), screenMat(laptopCount));
    laptopCount += 1;
    scr.position.set(0, 0.12, 0.009);
    lid.add(scr);
    room.add(g);
  }

  function cup(x, y, z) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    cyl(g, M.cup, 0.035, 0.03, 0.09, 0, 0.045, 0, 10);
    room.add(g);
  }

  // -- Layout: 4 round team tables x 5 seats, 7 round solo tables ---------------
  const TEAM_TABLES = [
    { x: -8.5, z: -4, r: 1.3, seats: 5, off: 0.3 },
    { x: -3, z: -4, r: 1.3, seats: 5, off: 0.9 },
    { x: -8.5, z: 0.5, r: 1.3, seats: 5, off: 0.6 },
    { x: -3, z: 0.5, r: 1.3, seats: 5, off: 1.2 },
  ];
  const SOLO_TABLES = [
    { x: 10.8, z: -6, a: Math.PI / 2 },
    { x: 10.8, z: -3.5, a: Math.PI / 2 },
    { x: 10.8, z: -1, a: Math.PI / 2 },
    { x: 10.8, z: 1.5, a: Math.PI / 2 },
    { x: -8, z: 6, a: 0 },
    { x: -3, z: 6, a: 0 },
    { x: 2, z: 6, a: 0 },
  ];
  let seatIndex = 0;
  function seatAt(tx, tz, angle, chairR, personR, laptopR, tableY) {
    const dx = Math.sin(angle);
    const dz = Math.cos(angle);
    chair(tx + dx * chairR, tz + dz * chairR, angle + Math.PI,
      flatMat(SEAT[seatIndex % SEAT.length], 0.85));
    person(tx + dx * personR, tz + dz * personR, angle + Math.PI, seatIndex);
    laptop(tx + dx * laptopR, tz + dz * laptopR, angle, tableY);
    seatIndex += 1;
  }
  for (const t of TEAM_TABLES) {
    roundTable(t.x, t.z, t.r, 0.8);
    pendant(t.x, t.z);
    for (let k = 0; k < t.seats; k++) {
      seatAt(t.x, t.z, t.off + (k / t.seats) * Math.PI * 2, t.r + 0.6, t.r + 0.45, t.r - 0.35, 0.8);
    }
    cup(t.x - 0.4, 0.8, t.z + 0.3);
    cup(t.x + 0.45, 0.8, t.z - 0.25);
  }
  for (const s of SOLO_TABLES) {
    roundTable(s.x, s.z, 0.55, 0.775);
    seatAt(s.x, s.z, s.a, 1.0, 0.85, 0.2, 0.775);
  }
  cup(-8 + 0.3, 0.775, 6 - 0.2);
  cup(-3 - 0.3, 0.775, 6 + 0.15);

  // -- Demo stage: platform, steps, backdrop, podium, mic, spotlight -----------
  const backdropTex = canvasTex(512, 288, (g) => {
    const bg = g.createLinearGradient(0, 0, 0, 288);
    bg.addColorStop(0, "#0b1526");
    bg.addColorStop(1, "#122a4a");
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 288);
    g.strokeStyle = "#00d2ff";
    g.lineWidth = 6;
    g.strokeRect(10, 10, 492, 268);
    g.fillStyle = "#f2f7ff";
    g.font = "800 64px -apple-system, 'Segoe UI', sans-serif";
    g.textAlign = "center";
    g.fillText("LIVE DEMOS", 256, 130);
    g.fillStyle = "#7ee2a8";
    g.font = "600 30px -apple-system, 'Segoe UI', sans-serif";
    g.fillText("every hour · on the hour", 256, 190);
    for (let i = 0; i < 12; i++) {
      g.fillStyle = i % 2 ? "#0082fb" : "#00d2ff";
      g.beginPath();
      g.arc(40 + i * 39, 240, 9, 0, Math.PI * 2);
      g.fill();
    }
  });
  {
    const stageWood = flatMat(0x3a2f28, 0.85);
    box(room, stageWood, 4, 0.55, 3.5, -10.5, 0.275, -6.75);
    box(room, stageWood, 0.35, 0.18, 1.2, -7.97, 0.09, -6.75);
    box(room, stageWood, 0.35, 0.37, 1.2, -8.32, 0.185, -6.75);
    box(room, M.tableLeg, 0.1, 2.6, 3.8, -12.45, 1.85, -6.75);
    const backdrop = new THREE.Mesh(
      new THREE.PlaneGeometry(3.6, 1.9),
      new THREE.MeshBasicMaterial({ map: backdropTex, toneMapped: false }),
    );
    backdrop.rotation.y = Math.PI / 2;
    backdrop.position.set(-12.38, 2.1, -6.75);
    room.add(backdrop);
    const strip = new THREE.Mesh(
      boxGeo(0.06, 0.08, 3.7),
      new THREE.MeshBasicMaterial({ color: 0x00d2ff, toneMapped: false }),
    );
    strip.position.set(-12.4, 3.25, -6.75);
    room.add(strip);
    box(room, M.tableTop, 0.5, 1.05, 0.45, -9.8, 1.075, -6.75);
    box(room, M.tableLeg, 0.56, 0.05, 0.5, -9.8, 1.62, -6.75);
    cyl(room, M.chairFrame, 0.015, 0.015, 0.35, -9.8, 1.82, -6.75, 8);
    sph(room, M.chairFrame, 0.035, -9.8, 2.0, -6.75, 10, 8);
    const spot = new THREE.SpotLight(0xbfe3ff, 60, 25, 0.5, 0.5);
    spot.position.set(-10.5, 6.5, -6.75);
    spot.target.position.set(-10.5, 0.5, -6.75);
    scene.add(spot);
    scene.add(spot.target);
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(1.7, 6, 24, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0x9fd8ff, transparent: true, opacity: 0.09,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    cone.position.set(-10.5, 3.75, -6.75);
    room.add(cone);
    const edgeGlow = new THREE.Mesh(
      boxGeo(0.05, 0.08, 3.5),
      new THREE.MeshBasicMaterial({ color: 0x00d2ff, toneMapped: false }),
    );
    edgeGlow.position.set(-8.48, 0.5, -6.75);
    room.add(edgeGlow);
  }

  // -- Food stall: counter, striped awning, crates, cups, sign ------------------
  const awningTex = canvasTex(256, 128, (g) => {
    for (let i = 0; i < 8; i++) {
      g.fillStyle = i % 2 ? "#f2f7ff" : "#1f8a4c";
      g.fillRect(i * 32, 0, 32, 128);
    }
  });
  const snackTex = canvasTex(512, 128, (g) => {
    g.fillStyle = "#10181d";
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = "#ffd166";
    g.font = "800 56px -apple-system, 'Segoe UI', sans-serif";
    g.textAlign = "center";
    g.fillText("SNACKS + DRINKS", 256, 84);
  });
  {
    const g = new THREE.Group();
    g.position.set(8.5, 0, 6.0);
    box(g, flatMat(0x7a2e2e, 0.8), 2.6, 1.0, 1.0, 0, 0.5, 0);
    box(g, M.tableTop, 2.8, 0.06, 1.1, 0, 1.03, 0);
    for (const sx of [-1.25, 1.25]) {
      for (const sz of [-0.5, 0.5]) {
        cyl(g, M.tableLeg, 0.04, 0.04, 2.6, sx, 1.3, sz, 8);
      }
    }
    const awn = new THREE.Mesh(
      new THREE.PlaneGeometry(3.0, 1.7),
      new THREE.MeshStandardMaterial({ map: awningTex, roughness: 0.9, side: THREE.DoubleSide }),
    );
    awn.rotation.x = -Math.PI / 2 + 0.35;
    awn.position.set(0, 2.75, 0);
    put(g, awn);
    const signB = new THREE.Mesh(
      new THREE.PlaneGeometry(1.9, 0.5),
      new THREE.MeshBasicMaterial({ map: snackTex, toneMapped: false }),
    );
    signB.rotation.y = Math.PI;
    signB.position.set(0, 2.2, -0.78);
    g.add(signB);
    box(g, flatMat(0x8a6742, 0.85), 0.5, 0.35, 0.4, -0.8, 1.24, 0.15);
    box(g, flatMat(0x3fa66a, 0.85), 0.45, 0.3, 0.38, -0.75, 1.55, 0.12);
    box(g, flatMat(0x2f6fed, 0.85), 0.5, 0.35, 0.4, 0.85, 1.24, 0.1);
    cyl(g, M.cup, 0.035, 0.03, 0.09, 0.1, 1.1, -0.2, 10);
    cyl(g, M.cup, 0.035, 0.03, 0.09, 0.3, 1.1, -0.25, 10);
    cyl(g, M.cup, 0.035, 0.03, 0.09, -0.2, 1.1, -0.22, 10);
    for (let i = 0; i < 3; i++) {
      cyl(g, M.cup, 0.14, 0.14, 0.025, 0.55, 1.08 + i * 0.028, -0.2, 16);
    }
    room.add(g);
    // bin nearby
    cyl(room, M.chairFrame, 0.28, 0.24, 0.7, 10.3, 0.35, 6.9, 14);
  }

  // -- Walking mentors (badges + clipboards) and the stage presenter ------------
  const walkers = [];
  function dampAngle(cur, target, dt, rate = 5) {
    let d = (target - cur) % (Math.PI * 2);
    if (d > Math.PI) {
      d -= Math.PI * 2;
    }
    if (d < -Math.PI) {
      d += Math.PI * 2;
    }
    return cur + d * Math.min(1, dt * rate);
  }
  function addWalker(waypoints, speed, idx, opts = {}) {
    const g = new THREE.Group();
    const skin = flatMat(SKIN[(idx + 2) % SKIN.length], 0.6);
    const shirt = flatMat(SHIRT[(idx + 3) % SHIRT.length], 0.85);
    const hairM = flatMat(HAIR[(idx + 1) % HAIR.length], 0.9);
    const pants = flatMat([0x2b3a4a, 0x3a3a3a, 0x4a3728][idx % 3], 0.9);
    const legs = [];
    for (const s of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(s * 0.09, 0.82, 0);
      g.add(hip);
      const thigh = new THREE.Mesh(cylGeo(0.06, 0.05, 0.4, 8), pants);
      thigh.position.y = -0.2;
      put(hip, thigh);
      const knee = new THREE.Group();
      knee.position.y = -0.4;
      hip.add(knee);
      const shin = new THREE.Mesh(cylGeo(0.05, 0.04, 0.38, 8), pants);
      shin.position.y = -0.19;
      put(knee, shin);
      const shoe = new THREE.Mesh(boxGeo(0.11, 0.07, 0.24), M.laptopShell);
      shoe.position.set(0, -0.38, 0.05);
      put(knee, shoe);
      legs.push({ hip, knee });
    }
    const torsoG = new THREE.Group();
    torsoG.position.y = 0.82;
    g.add(torsoG);
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.42, 6, 12), shirt);
    torso.position.y = 0.3;
    put(torsoG, torso);
    box(torsoG, M.cup, 0.1, 0.13, 0.02, 0, 0.32, 0.17);
    const headG = new THREE.Group();
    headG.position.set(0, 0.62, 0.02);
    torsoG.add(headG);
    sph(headG, skin, 0.13, 0, 0.1, 0.01, 18, 14);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.138, 18, 12, 0, Math.PI * 2, 0, 1.9), hairM,
    );
    hair.position.set(0, 0.115, -0.02);
    hair.rotation.x = -0.35;
    put(headG, hair);
    const arms = [];
    for (const s of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(s * 0.23, 0.48, 0.01);
      torsoG.add(sh);
      const upper = new THREE.Mesh(cylGeo(0.045, 0.04, 0.3, 8), shirt);
      upper.position.y = -0.15;
      put(sh, upper);
      const el = new THREE.Group();
      el.position.y = -0.3;
      el.rotation.x = -0.25;
      sh.add(el);
      const fore = new THREE.Mesh(cylGeo(0.038, 0.034, 0.28, 8), skin);
      fore.position.y = -0.14;
      put(el, fore);
      const hand = new THREE.Mesh(sphGeo(0.05, 10, 8), skin);
      hand.position.y = -0.3;
      put(el, hand);
      arms.push({ sh, el });
    }
    if (opts.clipboard !== false) {
      const board = new THREE.Mesh(boxGeo(0.16, 0.22, 0.02), flatMat(0x8a5a2e, 0.8));
      board.position.set(0, -0.32, 0.06);
      board.rotation.x = -0.5;
      put(arms[1].el, board);
    }
    const start = waypoints.length > 0 ? waypoints[0] : [opts.x || 0, opts.z || 0];
    g.position.set(start[0], opts.y || 0, start[1]);
    g.rotation.y = opts.yaw || 0;
    room.add(g);
    walkers.push({
      g, torsoG, headG, legs, arms,
      waypoints, speed,
      wpIndex: waypoints.length > 1 ? 1 : 0,
      stride: Math.random() * Math.PI * 2,
      yaw: opts.yaw || 0,
      idle: waypoints.length === 0,
      phase: idx * 2.3,
    });
  }

  function updateWalkers(dt, t) {
    for (const w of walkers) {
      if (!w.idle) {
        const target = w.waypoints[w.wpIndex];
        const dx = target[0] - w.g.position.x;
        const dz = target[1] - w.g.position.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.18) {
          w.wpIndex = (w.wpIndex + 1) % w.waypoints.length;
        } else {
          w.yaw = dampAngle(w.yaw, Math.atan2(dx, dz), dt, 5);
          w.g.position.x += Math.sin(w.yaw) * w.speed * dt;
          w.g.position.z += Math.cos(w.yaw) * w.speed * dt;
          w.stride += dt * w.speed * 4.2;
        }
        w.g.rotation.y = w.yaw;
        w.g.position.y = Math.abs(Math.sin(w.stride)) * 0.03;
        const s0 = Math.sin(w.stride);
        const s1 = Math.sin(w.stride + Math.PI);
        w.legs[0].hip.rotation.x = -s0 * 0.55;
        w.legs[1].hip.rotation.x = -s1 * 0.55;
        w.legs[0].knee.rotation.x = Math.max(0, Math.sin(w.stride - 2.0)) * 0.9;
        w.legs[1].knee.rotation.x = Math.max(0, Math.sin(w.stride + Math.PI - 2.0)) * 0.9;
        w.arms[0].sh.rotation.x = -s1 * 0.4;
        w.arms[1].sh.rotation.x = -s0 * 0.4;
        w.torsoG.rotation.y = Math.sin(w.stride) * 0.06;
        w.headG.rotation.y = Math.sin(t * 0.6 + w.phase) * 0.3;
      } else {
        // presenter idle: sway + gesture with the right arm
        w.torsoG.rotation.y = Math.sin(t * 0.5) * 0.15;
        w.headG.rotation.x = Math.sin(t * 0.9) * 0.06;
        w.arms[0].sh.rotation.x = -1.1 + Math.sin(t * 0.8) * 0.3;
        w.arms[1].sh.rotation.x = -0.15;
      }
    }
  }

  addWalker(
    [[-5.75, 3.8], [6, 3.8], [9, 1], [9, -4], [4, -6.8], [-4, -6.8], [-5.75, -6.6]],
    1.25, 0,
  );
  addWalker(
    [[6, 3.1], [0, 3.1], [0, -3.5], [6, -3.5]],
    1.1, 1,
  );
  addWalker([], 0, 2, { x: -10.6, z: -6.75, y: 0.55, yaw: Math.PI / 2, clipboard: false });

  // -- Controls: drag orbit, preset views, idle sway -------------------------
  const views = {
    overview: { yaw: 0, pitch: 0.52, r: 21, tx: 0, ty: 1.1, tz: 0 },
    teams: { yaw: -0.5, pitch: 0.45, r: 14, tx: -5.5, ty: 1, tz: -1.75 },
    solo: { yaw: 0.55, pitch: 0.45, r: 13, tx: 8.5, ty: 1, tz: 0 },
    stage: { yaw: 0.5, pitch: 0.35, r: 10, tx: -10, ty: 1.2, tz: -6.5 },
  };
  const goal = { ...views.overview };
  const cur = { ...views.overview };
  let baseYaw = 0;
  let elapsed = 0;
  let lastTouch = -99;
  let dirty = true;
  const buttons = controlsEl ? [...controlsEl.querySelectorAll("[data-view]")] : [];
  function setView(name) {
    const v = views[name];
    if (!v) {
      return;
    }
    goal.yaw = v.yaw;
    goal.pitch = v.pitch;
    goal.r = v.r;
    goal.tx = v.tx;
    goal.ty = v.ty;
    goal.tz = v.tz;
    baseYaw = v.yaw;
    lastTouch = elapsed;
    dirty = true;
  }
  buttons.forEach((b) => b.addEventListener("click", () => {
    setView(b.getAttribute("data-view"));
    buttons.forEach((o) => o.classList.toggle("active", o === b));
  }));
  if (buttons[0]) {
    buttons[0].classList.add("active");
  }

  let dragging = false;
  let px = 0;
  let py = 0;
  canvas.addEventListener("pointerdown", (e) => {
    dragging = true;
    px = e.clientX;
    py = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    lastTouch = elapsed;
    dirty = true;
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) {
      return;
    }
    goal.yaw = THREE.MathUtils.clamp(goal.yaw - (e.clientX - px) * 0.0052, -1.1, 1.1);
    goal.pitch = THREE.MathUtils.clamp(goal.pitch + (e.clientY - py) * 0.004, 0.15, 1.05);
    baseYaw = goal.yaw;
    px = e.clientX;
    py = e.clientY;
    lastTouch = elapsed;
    dirty = true;
  });
  const endDrag = () => {
    dragging = false;
    lastTouch = elapsed;
  };
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", endDrag);

  function applyCamera() {
    const cx = cur.tx + cur.r * Math.cos(cur.pitch) * Math.sin(cur.yaw);
    const cy = cur.ty + cur.r * Math.sin(cur.pitch);
    const cz = cur.tz + cur.r * Math.cos(cur.pitch) * Math.cos(cur.yaw);
    camera.position.set(cx, cy, cz);
    camera.lookAt(cur.tx, cur.ty, cur.tz);
  }

  // -- Resize + visibility (skip work while off-screen) ----------------------
  function resize() {
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) {
      return;
    }
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    dirty = true;
  }
  window.addEventListener("resize", resize);
  resize();
  let visible = true;
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (visible) {
        dirty = true;
      }
    });
    io.observe(wrap);
  }

  // -- Main loop ---------------------------------------------------------------
  const damp = (c, t, dt, r = 4) => c + (t - c) * Math.min(1, dt * r);
  let last = null;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible) {
      last = now;
      return;
    }
    if (last === null) {
      last = now;
    }
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!calm) {
      elapsed += dt;
      if (!dragging && elapsed - lastTouch > 3) {
        goal.yaw = baseYaw + Math.sin(elapsed * 0.12) * 0.22;
      }
      for (const k of ["yaw", "pitch", "r", "tx", "ty", "tz"]) {
        cur[k] = damp(cur[k], goal[k], dt);
      }
      applyCamera();
      updateWalkers(dt, elapsed);
      for (const p of people) {
        p.torsoG.position.y = 0.62 + Math.sin(elapsed * 7 + p.phase) * 0.008;
        p.headG.rotation.x = 0.12 + Math.sin(elapsed * 3.1 + p.phase) * 0.04;
        p.arms.forEach((a, i) => {
          a.el.rotation.x = -0.25 + Math.sin(elapsed * 7 + p.phase + i * 1.3) * 0.05;
        });
      }
      renderer.render(scene, camera);
    } else if (dirty) {
      dirty = false;
      for (const k of ["yaw", "pitch", "r", "tx", "ty", "tz"]) {
        cur[k] = goal[k];
      }
      applyCamera();
      renderer.render(scene, camera);
    }
  }
  applyCamera();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
