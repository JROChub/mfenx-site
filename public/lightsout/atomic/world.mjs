/* Copyright 2026 MFENX. All rights reserved. Rendering never supplies physics results. */
import * as THREE from '../../vendor/three.module.min.js';

const noise = (a, b, c = 0) => {
  const value = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453;
  return value - Math.floor(value);
};

function fallback(canvas, onPick) {
  const context = canvas.getContext('2d');
  let board = new Array(16).fill(2), modules = [], zeros = [], boxes = [];
  const draw = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * Math.min(devicePixelRatio, 1.5)));
    canvas.height = Math.max(1, Math.round(rect.height * Math.min(devicePixelRatio, 1.5)));
    if (!context) return;
    context.setTransform(canvas.width / rect.width, 0, 0, canvas.height / rect.height, 0, 0);
    const w = rect.width, h = rect.height;
    context.clearRect(0, 0, w, h);
    const cx = w * .56, cy = h * .52, scale = Math.min(w / 12, h / 10);
    const glow = context.createRadialGradient(cx, cy, 1, cx, cy, scale * 5);
    glow.addColorStop(0, '#efb56d16'); glow.addColorStop(1, '#efb56d00');
    context.fillStyle = glow; context.fillRect(0, 0, w, h);
    boxes = [];
    for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) {
      const tile = row * 4 + col, module = modules[board[tile]];
      const x = cx + (col - row) * scale, y = cy + (row + col - 3) * scale * .47;
      const height = zeros[tile] ? scale * .3 : scale * (1 + (module?.shift || 0) / 12);
      const color = zeros[tile] ? '#b7ec8c' : module?.color || '#efb56d';
      context.fillStyle = color + '25'; context.strokeStyle = color + '88';
      context.beginPath(); context.moveTo(x, y - height); context.lineTo(x + scale * .85, y + scale * .4 - height);
      context.lineTo(x, y + scale * .8 - height); context.lineTo(x - scale * .85, y + scale * .4 - height); context.closePath(); context.fill(); context.stroke();
      for (const direction of [-1, 1]) {
        context.beginPath(); context.moveTo(x, y + scale * .8 - height); context.lineTo(x + direction * scale * .85, y + scale * .4 - height);
        context.lineTo(x + direction * scale * .85, y + scale * .4); context.lineTo(x, y + scale * .8); context.closePath(); context.fill(); context.stroke();
      }
      boxes.push({tile, x, y: y + scale * .4 - height / 2, size: scale});
    }
  };
  canvas.addEventListener('click', event => {
    const rect = canvas.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    const match = boxes.reduce((best, box) => Math.hypot(box.x - x, box.y - y) < (best?.distance ?? box.size) ? {...box, distance: Math.hypot(box.x - x, box.y - y)} : best, null);
    if (match) onPick(match.tile);
  });
  const observer = new ResizeObserver(draw); observer.observe(canvas.parentElement);
  draw();
  return {setBoard(value, definitions) {board = [...value]; modules = definitions; zeros = []; draw();}, accept(report) {zeros = report.stages[1].shifts.map(v => v === 32); draw();}, invalidate() {zeros = []; draw();}, setPaused() {}, dispose() {observer.disconnect();}};
}

export function createWorld(initialCanvas, onPick) {
  let canvas = initialCanvas;
  let gl;
  try { gl = canvas.getContext('webgl2', {alpha: true, antialias: true, powerPreference: 'low-power'}); } catch { gl = null; }
  if (!gl) return fallback(canvas, onPick);
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, context: gl, alpha: true, antialias: true}); }
  catch {
    const replacement = canvas.cloneNode(); canvas.replaceWith(replacement); canvas = replacement;
    return fallback(canvas, onPick);
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, .1, 160);
  camera.position.set(13, 12, 18); camera.lookAt(0, 0, 0);
  scene.add(new THREE.AmbientLight(0x9ca8be, 1.5));
  const key = new THREE.DirectionalLight(0xffd7a0, 5); key.position.set(-4, 8, 5); scene.add(key);
  const fill = new THREE.DirectionalLight(0x6cbfce, 3); fill.position.set(6, 2, -6); scene.add(fill);
  const point = new THREE.PointLight(0xef983e, 95, 22, 2); point.position.set(0, 2, 4); scene.add(point);
  const reactor = new THREE.Group(); scene.add(reactor);
  const shell = new THREE.Group(); reactor.add(shell);
  const geometry = new THREE.BoxGeometry(.49, .49, .49);
  const material = new THREE.MeshStandardMaterial({color: 0xffffff, metalness: .68, roughness: .35, emissive: 0x533014, emissiveIntensity: .14});
  const cubes = new THREE.InstancedMesh(geometry, material, 2600); cubes.instanceMatrix.setUsage(THREE.DynamicDrawUsage); shell.add(cubes);
  const atomGeometry = new THREE.IcosahedronGeometry(.085, 0);
  const atoms = new THREE.InstancedMesh(atomGeometry, new THREE.MeshBasicMaterial({color: 0xefbc78}), 320); reactor.add(atoms);
  const dummy = new THREE.Object3D(), color = new THREE.Color();
  let entries = [], board = new Array(16).fill(2), modules = [], report = null, acceptedAt = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches, dirty = true, visible = true;
  let yaw = -.3, tilt = 0, disposed = false, lastFrame = 0;
  const orbitMaterials = [];
  for (let ringIndex = 0; ringIndex < 3; ringIndex++) {
    const points = [];
    for (let i = 0; i <= 200; i++) {const angle = i / 200 * Math.PI * 2; points.push(new THREE.Vector3(Math.cos(angle) * (6.5 + ringIndex * .45), 0, Math.sin(angle) * (6.5 + ringIndex * .45)));}
    const ringMaterial = new THREE.LineBasicMaterial({color: ringIndex === 1 ? 0x78c6c2 : 0xd9a46b, transparent: true, opacity: .18});
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), ringMaterial);
    ring.rotation.z = ringIndex === 0 ? .12 : ringIndex === 1 ? .85 : -.85;
    ring.rotation.x = ringIndex === 0 ? 0 : .3;
    reactor.add(ring); orbitMaterials.push(ringMaterial);
  }
  const cage = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(6.1, 1)), new THREE.LineBasicMaterial({color: 0xd5a26d, transparent: true, opacity: .055})); reactor.add(cage);
  const base = new THREE.Group(); base.position.y = -4.2; reactor.add(base);
  for (let j = 0; j < 3; j++) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(3.8 + j * .65, 3.82 + j * .65, 100), new THREE.MeshBasicMaterial({color: 0xd4a470, transparent: true, opacity: .14 - j * .025, side: THREE.DoubleSide}));
    ring.rotation.x = -Math.PI / 2; base.add(ring);
  }
  const starVertices = [];
  for (let i = 0; i < 550; i++) starVertices.push((noise(i, 2) - .5) * 90, (noise(i, 3) - .5) * 60, (noise(i, 4) - .5) * 70 - 15);
  const starGeometry = new THREE.BufferGeometry(); starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starVertices, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({color: 0xbec6cb, size: .04, transparent: true, opacity: .48, sizeAttenuation: true})); scene.add(stars);
  const glowCanvas = document.createElement('canvas'); glowCanvas.width = glowCanvas.height = 128;
  const glowContext = glowCanvas.getContext('2d');
  const glow = glowContext.createRadialGradient(64, 64, 0, 64, 64, 64);
  glow.addColorStop(0, '#ef9c4240'); glow.addColorStop(.3, '#cf782215'); glow.addColorStop(1, '#ad561100');
  glowContext.fillStyle = glow; glowContext.fillRect(0, 0, 128, 128);
  const glowTexture = new THREE.CanvasTexture(glowCanvas);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({map: glowTexture, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false})); halo.scale.set(23, 23, 1); halo.position.set(0, 0, -3); scene.add(halo);

  function rebuild() {
    entries = [];
    for (let tile = 0; tile < 16; tile++) {
      const row = Math.floor(tile / 4), col = tile % 4, module = modules[board[tile]];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
        const x = (col - 1.5) * 1.98 + (c - 1.5) * .48;
        const z = (row - 1.5) * 1.98 + (r - 1.5) * .48;
        const center = Math.max(0, 1 - Math.hypot(x, z) / 6);
        const height = 1 + Math.floor(center * 5 + noise(tile, r, c) * 2 + (module?.shift || 0) / 7);
        for (let y = 0; y < height; y++) entries.push({tile, x, y: y * .51 - 2.4, z, color: module?.color || '#efb56d', brightness: .24 + y / height * .65, offset: noise(tile, y, r * 4 + c)});
      }
    }
    cubes.count = entries.length;
    for (let i = 0; i < 180; i++) {
      const radius = 5.1 + noise(i, 7) * 2.7, angle = noise(i, 8) * Math.PI * 2;
      dummy.position.set(Math.cos(angle) * radius, (noise(i, 9) - .5) * 10, Math.sin(angle) * radius);
      dummy.rotation.set(i, i * .3, 0); dummy.scale.setScalar(.3 + noise(i, 10) * .9); dummy.updateMatrix(); atoms.setMatrixAt(i, dummy.matrix);
    }
    atoms.count = 180; atoms.instanceMatrix.needsUpdate = true;
    dirty = true;
  }
  function updateCubes(now) {
    const progress = report ? paused ? 1 : Math.min(1, Math.max(0, (now - acceptedAt) / 1800)) : 0;
    const ease = progress * progress * (3 - 2 * progress);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const zero = report && report.stages[1].shifts[entry.tile] === 32;
      const collapse = zero ? ease : 0;
      dummy.position.set(entry.x * (1 + collapse * .07), entry.y * (1 - collapse * .42) + collapse * (entry.offset - .5) * .7, entry.z * (1 + collapse * .07));
      dummy.rotation.set(collapse * entry.offset * .5, collapse * entry.offset * .8, 0);
      dummy.scale.setScalar((.89 + entry.offset * .06) * (1 - collapse * .37)); dummy.updateMatrix(); cubes.setMatrixAt(i, dummy.matrix);
      color.set(entry.color).multiplyScalar(entry.brightness + collapse * .6);
      if (zero) color.lerp(new THREE.Color(0xb7ec8c), collapse * .62);
      cubes.setColorAt(i, color);
    }
    cubes.instanceMatrix.needsUpdate = true; if (cubes.instanceColor) cubes.instanceColor.needsUpdate = true;
  }
  const resize = () => {
    const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.position.set(13, 12, 18).multiplyScalar(w < 550 ? 1.13 : 1);
    camera.lookAt(w < 550 ? 0 : -1.15, .1, 0); camera.updateProjectionMatrix(); dirty = true;
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement);
  const visibility = new IntersectionObserver(items => {visible = items[0].isIntersecting; dirty = true;}, {rootMargin: '100px'}); visibility.observe(canvas);
  const raycaster = new THREE.Raycaster(); let pointer = null;
  canvas.addEventListener('pointerdown', event => {pointer = {x: event.clientX, y: event.clientY, yaw, tilt, moved: false};});
  canvas.addEventListener('pointermove', event => {
    if (!pointer) return;
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) pointer.moved = true;
    if (pointer.moved) {yaw = pointer.yaw + dx * .006; tilt = Math.max(-.22, Math.min(.22, pointer.tilt + dy * .002)); dirty = true;}
  });
  canvas.addEventListener('pointerup', event => {
    if (!pointer) return;
    if (!pointer.moved) {
      const rect = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
      const hit = raycaster.intersectObject(cubes)[0];
      if (hit && entries[hit.instanceId]) onPick(entries[hit.instanceId].tile);
    }
    pointer = null;
  });
  canvas.addEventListener('pointerleave', () => {pointer = null;});
  canvas.addEventListener('pointercancel', () => {pointer = null;});
  canvas.addEventListener('webglcontextlost', event => {event.preventDefault(); visible = false;});
  canvas.addEventListener('webglcontextrestored', () => {visible = true; dirty = true;});
  let frame;
  function animate(now) {
    if (disposed) return;
    frame = requestAnimationFrame(animate);
    if (!visible || document.hidden || now - lastFrame < 1000 / 35) return;
    const animatingCollapse = report && now - acceptedAt < 1900;
    if (paused && !dirty && !animatingCollapse) return;
    const elapsed = Math.min(100, now - lastFrame); lastFrame = now;
    if (!paused && !pointer) yaw += elapsed * .000035;
    reactor.rotation.set(tilt, yaw, 0); reactor.position.y = paused ? 0 : Math.sin(now * .00045) * .12;
    atoms.rotation.y = paused ? 0 : now * .000035;
    if (dirty || animatingCollapse) updateCubes(now);
    if (report) {halo.material.color.set(report.won ? 0xc4ed96 : 0xf5bd76); orbitMaterials[0].opacity = .3;}
    else {halo.material.color.set(0xffffff); orbitMaterials[0].opacity = .18;}
    renderer.render(scene, camera); dirty = false;
  }
  rebuild(); resize(); frame = requestAnimationFrame(animate);
  return {
    setBoard(value, definitions) {board = [...value]; modules = definitions; report = null; rebuild();},
    accept(value) {report = value; acceptedAt = performance.now(); dirty = true;},
    invalidate() {report = null; dirty = true;},
    setPaused(value) {paused = value; dirty = true;},
    dispose() {disposed = true; cancelAnimationFrame(frame); observer.disconnect(); visibility.disconnect(); renderer.dispose(); scene.traverse(object => {object.geometry?.dispose(); if (object.material) {for (const item of Array.isArray(object.material) ? object.material : [object.material]) item.dispose();}}); glowTexture.dispose();}
  };
}
