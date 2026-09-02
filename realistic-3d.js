const app = document.getElementById('tattoo3DApp');
const $ = id => app.querySelector('#' + id);
const status = $('t3Status');
const ui = {
  gender: $('t3Gender'), file: $('t3TattooInput'), fileName: $('t3FileName'),
  removeBg: $('t3RemoveBg'), flip: $('t3Flip'), scale: $('t3Scale'),
  rotation: $('t3Rotation'), vertical: $('t3Vertical'), angle: $('t3Angle'),
  wrap: $('t3Wrap'), opacity: $('t3Opacity'), ink: $('t3Ink')
};
const labels = {
  scale: $('t3ScaleValue'), rotation: $('t3RotationValue'), vertical: $('t3VerticalValue'),
  angle: $('t3AngleValue'), wrap: $('t3WrapValue'), opacity: $('t3OpacityValue'), ink: $('t3InkValue')
};

let THREE, OrbitControls, GLTFLoader, DecalGeometry;
let renderer, scene, camera, orbit, modelRoot, bodyMesh, decalGroup;
let tattooImage = null;
let selectedHit = null;
let currentZone = 'chest';
let ready = false;
let loadingToken = 0;
let pointerStart = null;

const zoneConfig = {
  chest:        { target: [0, 1.22, 0], radius: 6.0 },
  leftArm:      { target: [-1.55, 1.05, 0], radius: 5.3 },
  rightArm:     { target: [1.55, 1.05, 0], radius: 5.3 },
  leftForearm:  { target: [-2.05, .32, 0], radius: 4.8 },
  rightForearm: { target: [2.05, .32, 0], radius: 4.8 },
  leftThigh:    { target: [-.52, -1.02, 0], radius: 4.8 },
  rightThigh:   { target: [.52, -1.02, 0], radius: 4.8 },
  leftCalf:     { target: [-.48, -2.35, 0], radius: 4.4 },
  rightCalf:    { target: [.48, -2.35, 0], radius: 4.4 }
};

function toast(text) {
  const el = $('t3Toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2200);
}

function updateLabels() {
  labels.scale.textContent = ui.scale.value + '%';
  labels.rotation.textContent = ui.rotation.value + '°';
  labels.vertical.textContent = ui.vertical.value;
  labels.angle.textContent = ui.angle.value + '%';
  labels.wrap.textContent = ui.wrap.value + '°';
  labels.opacity.textContent = ui.opacity.value + '%';
  labels.ink.textContent = ui.ink.value + '%';
}

try {
  THREE = await import('three');
  ({ OrbitControls } = await import('three/addons/controls/OrbitControls.js'));
  ({ GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js'));
  ({ DecalGeometry } = await import('three/addons/geometries/DecalGeometry.js'));
  init();
} catch (error) {
  console.error(error);
  status.innerHTML = 'Не удалось загрузить 3D-модуль.<small>Разрешите сайту доступ к cdn.jsdelivr.net и обновите страницу.</small>';
}

function init() {
  const host = $('t3Viewport');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d11);
  scene.fog = new THREE.Fog(0x0b0d11, 11, 22);

  camera = new THREE.PerspectiveCamera(34, 1, .05, 40);
  camera.position.set(0, .4, 10);

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.dampingFactor = .075;
  orbit.target.set(0, .35, 0);
  orbit.minDistance = 2.1;
  orbit.maxDistance = 14;
  orbit.enablePan = false;

  scene.add(new THREE.HemisphereLight(0xdce9ff, 0x33261f, 2.35));
  const key = new THREE.DirectionalLight(0xffe7d3, 4.2);
  key.position.set(4.5, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0x819fff, 2.1);
  fill.position.set(-5, 3, -4);
  scene.add(fill);
  const front = new THREE.DirectionalLight(0xffd9c2, 1.3);
  front.position.set(0, 1, 7);
  scene.add(front);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.7, 64),
    new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: .9, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -3.51;
  floor.receiveShadow = true;
  scene.add(floor);

  decalGroup = new THREE.Group();
  decalGroup.name = 'tattoo_decals';
  scene.add(decalGroup);

  new ResizeObserver(resize).observe(host);
  renderer.setAnimationLoop(() => {
    orbit.update();
    renderer.render(scene, camera);
  });

  bindEvents();
  resize();
  loadModel(ui.gender.value);
}

function loadModel(gender) {
  const token = ++loadingToken;
  ready = false;
  selectedHit = null;
  clearDecals();
  $('t3Download').disabled = true;
  status.hidden = false;
  status.innerHTML = `Загрузка ${gender === 'male' ? 'мужской' : 'женской'} модели…<small>Файл оптимизирован для браузера.</small>`;
  if (modelRoot) {
    scene.remove(modelRoot);
    disposeObject(modelRoot);
    modelRoot = null;
    bodyMesh = null;
  }

  new GLTFLoader().load(
    `models/${gender}.glb`,
    gltf => {
      if (token !== loadingToken) return;
      modelRoot = gltf.scene;
      const meshes = [];
      modelRoot.traverse(object => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
        if (object.material) {
          object.material.roughness = .76;
          object.material.metalness = 0;
          object.material.needsUpdate = true;
        }
        meshes.push(object);
      });
      bodyMesh = meshes.sort((a, b) => (b.geometry.attributes.position?.count || 0) - (a.geometry.attributes.position?.count || 0))[0];
      if (!bodyMesh) throw new Error('Body mesh not found');
      scene.add(modelRoot);
      ready = true;
      status.hidden = true;
      $('t3Download').disabled = false;
      setZone(currentZone, true);
      toast(gender === 'male' ? 'Мужская модель загружена' : 'Женская модель загружена');
    },
    progress => {
      if (!progress.total || token !== loadingToken) return;
      const percent = Math.round(progress.loaded / progress.total * 100);
      status.innerHTML = `Загрузка модели: ${percent}%<small>Подготавливаем поверхность кожи.</small>`;
    },
    error => {
      console.error(error);
      if (token !== loadingToken) return;
      status.hidden = false;
      status.innerHTML = 'Модель не найдена.<small>Проверьте, что папка models лежит рядом с HTML-файлом.</small>';
    }
  );
}

function disposeObject(root) {
  root.traverse(object => {
    if (object.geometry) object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach(material => {
      Object.values(material).forEach(value => value?.isTexture && value.dispose());
      material.dispose();
    });
  });
}

function clearDecals() {
  while (decalGroup?.children.length) {
    const decal = decalGroup.children.pop();
    decal.geometry?.dispose();
    decal.material?.map?.dispose();
    decal.material?.dispose();
  }
}

function setView(view) {
  if (!camera || !orbit) return;
  const target = new THREE.Vector3(0, .35, 0);
  const positions = {
    front: new THREE.Vector3(0, .4, 10),
    side: new THREE.Vector3(9, .4, 0),
    back: new THREE.Vector3(0, .4, -10)
  };
  camera.position.copy(positions[view]);
  orbit.target.copy(target);
  orbit.update();
}

function setZone(zone, place = true) {
  currentZone = zone;
  const config = zoneConfig[zone] || zoneConfig.chest;
  const target = new THREE.Vector3(...config.target);
  const theta = (Number(ui.angle.value) / 100 - .5) * Math.PI * 2;
  const direction = new THREE.Vector3(Math.sin(theta), 0, Math.cos(theta));
  camera.position.copy(target).addScaledVector(direction, config.radius);
  orbit.target.copy(target);
  orbit.update();
  app.querySelectorAll('[data-zone]').forEach(button => {
    button.classList.toggle('active', button.dataset.zone === zone && Number(button.dataset.angle || 50) === Number(ui.angle.value));
  });
  if (place && ready) requestAnimationFrame(() => placeFromCameraCenter(true));
}

function placeFromCameraCenter(silent = false) {
  if (!ready || !bodyMesh) return false;
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const hit = ray.intersectObject(bodyMesh, false)[0];
  if (!hit) {
    if (!silent) toast('Нажмите на нужное место на коже');
    return false;
  }
  storeHit(hit);
  rebuildDecal();
  return true;
}

function storeHit(hit) {
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  selectedHit = {
    point: hit.point.clone(),
    normal,
    object: hit.object
  };
}

function processedTattoo() {
  if (!tattooImage) return null;
  const maxSide = 1200;
  const ratio = Math.min(1, maxSide / Math.max(tattooImage.naturalWidth, tattooImage.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(tattooImage.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(tattooImage.naturalHeight * ratio));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(tattooImage, 0, 0, canvas.width, canvas.height);

  if (ui.removeBg.checked) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < image.data.length; i += 4) {
      const r = image.data[i], g = image.data[i + 1], b = image.data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const luminance = .2126 * r + .7152 * g + .0722 * b;
      if (max - min < 34 && luminance > 184) {
        image.data[i + 3] = Math.round(image.data[i + 3] * Math.max(0, (244 - luminance) / 60));
      }
    }
    context.putImageData(image, 0, 0);
  }
  return canvas;
}

function makeTattooTexture() {
  const source = processedTattoo();
  if (!source) return null;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const context = canvas.getContext('2d');
  const padding = 72;
  const maxWidth = canvas.width - padding * 2;
  const maxHeight = canvas.height - padding * 2;
  const ratio = Math.min(maxWidth / source.width, maxHeight / source.height);
  const width = source.width * ratio, height = source.height * ratio;
  context.translate(512, 512);
  context.scale(ui.flip.checked ? -1 : 1, 1);
  context.globalAlpha = Math.min(1, Number(ui.ink.value) / 100);
  context.drawImage(source, -width / 2, -height / 2, width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.needsUpdate = true;
  return texture;
}

function rebuildDecal() {
  clearDecals();
  if (!ready || !tattooImage || !selectedHit) {
    $('t3Before').disabled = true;
    return;
  }

  const texture = makeTattooTexture();
  const aspect = tattooImage.naturalWidth / tattooImage.naturalHeight || 1;
  const scale = Number(ui.scale.value) / 100;
  const base = .82 * scale;
  let width = base * Math.sqrt(aspect), height = base / Math.sqrt(aspect);
  const wrap = Number(ui.wrap.value);
  width *= .72 + wrap / 210;
  const depth = Math.max(.42, width * (.35 + wrap / 320));

  const position = selectedHit.point.clone();
  position.y += Number(ui.vertical.value) / 100 * .72;
  position.addScaledVector(selectedHit.normal, .012);

  const helper = new THREE.Object3D();
  helper.position.copy(position);
  helper.lookAt(position.clone().add(selectedHit.normal));
  helper.rotateZ(THREE.MathUtils.degToRad(Number(ui.rotation.value)));

  const size = new THREE.Vector3(width, height, depth);
  const geometry = new DecalGeometry(selectedHit.object, position, helper.rotation, size);
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: Number(ui.opacity.value) / 100,
    alphaTest: .012,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -5,
    roughness: .8,
    metalness: 0,
    side: THREE.DoubleSide
  });
  const decal = new THREE.Mesh(geometry, material);
  decal.renderOrder = 3;
  decalGroup.add(decal);
  $('t3Before').disabled = false;
}

function loadTattoo(file) {
  if (!file || !file.type.startsWith('image/')) return toast('Выберите PNG, JPG или WebP');
  const image = new Image();
  const url = URL.createObjectURL(file);
  image.onload = () => {
    URL.revokeObjectURL(url);
    tattooImage = image;
    ui.fileName.textContent = file.name;
    if (!selectedHit) placeFromCameraCenter(true);
    rebuildDecal();
    toast('Эскиз нанесён на тело');
  };
  image.onerror = () => {
    URL.revokeObjectURL(url);
    toast('Не удалось открыть изображение');
  };
  image.src = url;
}

function resize() {
  if (!renderer) return;
  const host = $('t3Viewport');
  const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function bindEvents() {
  ui.gender.addEventListener('change', () => loadModel(ui.gender.value));
  ui.file.addEventListener('change', () => loadTattoo(ui.file.files[0]));
  [ui.removeBg, ui.flip].forEach(element => element.addEventListener('change', rebuildDecal));
  [ui.scale, ui.rotation, ui.vertical, ui.wrap, ui.opacity, ui.ink].forEach(element => {
    element.addEventListener('input', () => {
      updateLabels();
      rebuildDecal();
    });
  });
  ui.angle.addEventListener('input', () => {
    updateLabels();
    setZone(currentZone, true);
  });

  app.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
  app.querySelectorAll('[data-zone]').forEach(button => button.addEventListener('click', () => {
    ui.angle.value = button.dataset.angle || 50;
    updateLabels();
    setZone(button.dataset.zone, true);
  }));

  renderer.domElement.addEventListener('pointerdown', event => {
    pointerStart = { x: event.clientX, y: event.clientY };
  });
  renderer.domElement.addEventListener('pointerup', event => {
    if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7 || !bodyMesh) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(mouse, camera);
    const hit = ray.intersectObject(bodyMesh, false)[0];
    if (hit) {
      storeHit(hit);
      rebuildDecal();
      if (!tattooImage) toast('Место выбрано — теперь загрузите эскиз');
    }
    pointerStart = null;
  });

  const before = $('t3Before');
  const hide = () => {
    decalGroup.visible = false;
    before.classList.add('active');
    before.textContent = 'Сейчас: БЕЗ ТАТУ';
  };
  const show = () => {
    decalGroup.visible = true;
    before.classList.remove('active');
    before.textContent = 'Удерживать: ДО';
  };
  before.addEventListener('pointerdown', hide);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(type => before.addEventListener(type, show));

  $('t3Reset').addEventListener('click', () => {
    ui.scale.value = 100;
    ui.rotation.value = 0;
    ui.vertical.value = 0;
    ui.angle.value = 50;
    ui.wrap.value = 120;
    ui.opacity.value = 82;
    ui.ink.value = 92;
    updateLabels();
    setZone('chest', true);
    toast('Настройки сброшены');
  });

  $('t3Download').addEventListener('click', () => {
    renderer.render(scene, camera);
    renderer.domElement.toBlob(blob => {
      if (!blob) return toast('Не удалось сохранить ракурс');
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `realistic-tattoo-3d-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(link.href), 1400);
      toast('Ракурс сохранён');
    }, 'image/png', 1);
  });
}

updateLabels();
