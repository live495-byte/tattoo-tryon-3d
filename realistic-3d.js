const app = document.getElementById('tattoo3DApp');
const $ = id => app.querySelector('#' + id);
const status = $('t3Status');

const ui = {
  gender: $('t3Gender'),
  file: $('t3TattooInput'),
  fileName: $('t3FileName'),
  removeBg: $('t3RemoveBg'),
  flip: $('t3Flip'),
  scale: $('t3Scale'),
  rotation: $('t3Rotation'),
  vertical: $('t3Vertical'),
  angle: $('t3Angle'),
  wrap: $('t3Wrap'),
  opacity: $('t3Opacity'),
  ink: $('t3Ink')
};

const labels = {
  scale: $('t3ScaleValue'),
  rotation: $('t3RotationValue'),
  vertical: $('t3VerticalValue'),
  angle: $('t3AngleValue'),
  wrap: $('t3WrapValue'),
  opacity: $('t3OpacityValue'),
  ink: $('t3InkValue')
};

let THREE, OrbitControls, GLTFLoader, DecalGeometry;
let renderer, scene, camera, orbit, modelRoot, decalGroup;
let bodyMeshes = [];
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
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2400);
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
  status.innerHTML =
    'Не удалось загрузить 3D-модуль.<small>Проверьте доступ к cdn.jsdelivr.net и обновите страницу.</small>';
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
  renderer.toneMappingExposure = 1.02;
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

  scene.add(new THREE.HemisphereLight(0xe8f1ff, 0x30241d, 2.0));

  const key = new THREE.DirectionalLight(0xffe7d3, 3.4);
  key.position.set(4.5, 7, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.camera.left = key.shadow.camera.bottom = -5;
  key.shadow.camera.right = key.shadow.camera.top = 5;
  scene.add(key);

  const fill = new THREE.DirectionalLight(0x8da7ff, 1.35);
  fill.position.set(-5, 3, -4);
  scene.add(fill);

  const front = new THREE.DirectionalLight(0xffdcc8, 1.1);
  front.position.set(0, 1, 7);
  scene.add(front);

  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(4.7, 64),
    new THREE.MeshStandardMaterial({ color: 0x15181d, roughness: .92, metalness: 0 })
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

function disposeObject(root) {
  root.traverse(object => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.filter(Boolean).forEach(material => {
      Object.values(material).forEach(value => value?.isTexture && value.dispose());
      material.dispose?.();
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

function isLikelyBodyMesh(mesh) {
  if (!mesh?.isMesh || !mesh.geometry?.attributes?.position) return false;

  const name = `${mesh.name || ''} ${mesh.parent?.name || ''}`.toLowerCase();
  const reject = [
    'eye', 'eyeball', 'lash', 'teeth', 'tongue', 'hair', 'brow',
    'cloth', 'shirt', 'pants', 'shoe', 'sock', 'underwear'
  ];
  if (reject.some(word => name.includes(word))) return false;

  // Не отбрасываем небольшие skin-меши: руки/голова могут быть отдельными.
  return mesh.geometry.attributes.position.count > 100;
}

function smoothAndPrepareMesh(mesh) {
  const geometry = mesh.geometry;

  try {
    geometry.computeVertexNormals();
    geometry.normalizeNormals?.();
  } catch (e) {
    console.warn('Normal smoothing skipped:', e);
  }

  const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];

  sourceMaterials.filter(Boolean).forEach(material => {
    material.flatShading = false;
    material.roughness = .82;
    material.metalness = 0;
    material.envMapIntensity = .25;

    // Нейтральный натуральный оттенок кожи вместо "пластика".
    if (material.color && !material.map) {
      material.color.set(0xd89f7f);
    }

    material.needsUpdate = true;
  });

  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
}

function applyBodyProfile(root, gender) {
  // Лёгкая деформация текущих MakeHuman-моделей.
  // Она нужна только как временный fallback, пока не положены новые male-v2/female-v2.glb.
  const box = new THREE.Box3().setFromObject(root);
  const minY = box.min.y;
  const height = Math.max(.001, box.max.y - box.min.y);

  root.traverse(mesh => {
    if (!isLikelyBodyMesh(mesh)) return;

    const pos = mesh.geometry.attributes.position;
    const temp = new THREE.Vector3();

    for (let i = 0; i < pos.count; i++) {
      temp.fromBufferAttribute(pos, i);
      const world = temp.clone();
      mesh.localToWorld(world);

      const t = (world.y - minY) / height; // 0 feet -> 1 head

      let sx = 1;
      let sz = 1;

      if (gender === 'female') {
        // плечи уже
        if (t > .68 && t < .86) sx *= .91;
        // талия
        if (t > .50 && t < .68) sx *= .92;
        // таз/бедра
        if (t > .31 && t <= .52) sx *= 1.09;
        // грудная клетка чуть глубже
        if (t > .61 && t < .76) sz *= 1.045;
      } else {
        // плечи шире
        if (t > .67 && t < .86) sx *= 1.075;
        // таз чуть уже
        if (t > .31 && t < .54) sx *= .965;
        // грудная клетка массивнее
        if (t > .59 && t < .78) sz *= 1.035;
      }

      temp.x *= sx;
      temp.z *= sz;
      pos.setXYZ(i, temp.x, temp.y, temp.z);
    }

    pos.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
    mesh.geometry.computeVertexNormals();
  });
}

function fitModel(root) {
  // Центруем модель и подгоняем по высоте к прежней системе координат.
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);

  if (size.y > 0) {
    const targetHeight = 6.9;
    const s = targetHeight / size.y;
    root.scale.multiplyScalar(s);
  }

  const box2 = new THREE.Box3().setFromObject(root);
  const center2 = new THREE.Vector3();
  box2.getCenter(center2);
  root.position.x -= center2.x;
  root.position.z -= center2.z;

  const floorY = -3.5;
  root.position.y += floorY - box2.min.y;
}

function modelCandidates(gender) {
  // Если позже добавите качественные модели V2 — код начнёт использовать их автоматически.
  return [
    `models/${gender}-v2.glb`,
    `models/${gender}.glb`
  ];
}

async function loadFirstAvailableModel(gender, token) {
  const loader = new GLTFLoader();
  const urls = modelCandidates(gender);
  let lastError;

  for (const url of urls) {
    try {
      const gltf = await loader.loadAsync(url);
      if (token !== loadingToken) return null;
      return { gltf, url };
    } catch (error) {
      lastError = error;
      console.warn('Model candidate failed:', url, error);
    }
  }
  throw lastError || new Error('No model file found');
}

async function loadModel(gender) {
  const token = ++loadingToken;
  ready = false;
  selectedHit = null;
  bodyMeshes = [];
  clearDecals();

  $('t3Download').disabled = true;
  status.hidden = false;
  status.innerHTML =
    `Загрузка ${gender === 'male' ? 'мужской' : 'женской'} модели…` +
    `<small>Подготавливаем поверхность кожи.</small>`;

  if (modelRoot) {
    scene.remove(modelRoot);
    disposeObject(modelRoot);
    modelRoot = null;
  }

  try {
    const result = await loadFirstAvailableModel(gender, token);
    if (!result || token !== loadingToken) return;

    modelRoot = result.gltf.scene;

    modelRoot.traverse(object => {
      if (!object.isMesh) return;
      smoothAndPrepareMesh(object);
      if (isLikelyBodyMesh(object)) bodyMeshes.push(object);
    });

    if (!bodyMeshes.length) {
      throw new Error('Body meshes not found');
    }

    // Только старые модели слегка морфим, V2 оставляем как есть.
    if (!result.url.includes('-v2.glb')) {
      applyBodyProfile(modelRoot, gender);
    }

    fitModel(modelRoot);
    scene.add(modelRoot);

    // После трансформаций обновляем матрицы.
    modelRoot.updateMatrixWorld(true);

    ready = true;
    status.hidden = true;
    $('t3Download').disabled = false;

    setZone(currentZone, true);

    toast(
      gender === 'male'
        ? 'Мужская модель готова'
        : 'Женская модель готова'
    );
  } catch (error) {
    console.error(error);
    if (token !== loadingToken) return;
    status.hidden = false;
    status.innerHTML =
      'Модель не найдена.<small>Проверьте файлы в папке models.</small>';
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

  camera.position.copy(positions[view] || positions.front);
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
    button.classList.toggle(
      'active',
      button.dataset.zone === zone &&
      Number(button.dataset.angle || 50) === Number(ui.angle.value)
    );
  });

  if (place && ready) {
    requestAnimationFrame(() => placeFromCameraCenter(true));
  }
}

function getRayHit(ndc = new THREE.Vector2(0, 0)) {
  if (!ready || !bodyMeshes.length) return null;

  const ray = new THREE.Raycaster();
  ray.setFromCamera(ndc, camera);

  const hits = ray.intersectObjects(bodyMeshes, false);

  // Берём первый валидный треугольник кожи.
  return hits.find(hit => hit.face && hit.object?.isMesh) || null;
}

function placeFromCameraCenter(silent = false) {
  const hit = getRayHit(new THREE.Vector2(0, 0));

  if (!hit) {
    if (!silent) toast('Нажмите на нужное место на коже');
    return false;
  }

  storeHit(hit);
  rebuildDecal();
  return true;
}

function storeHit(hit) {
  const normal = hit.face.normal
    .clone()
    .transformDirection(hit.object.matrixWorld)
    .normalize();

  selectedHit = {
    point: hit.point.clone(),
    normal,
    object: hit.object
  };
}

function processedTattoo() {
  if (!tattooImage) return null;

  const maxSide = 1400;
  const ratio = Math.min(
    1,
    maxSide / Math.max(tattooImage.naturalWidth, tattooImage.naturalHeight)
  );

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(tattooImage.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(tattooImage.naturalHeight * ratio));

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(tattooImage, 0, 0, canvas.width, canvas.height);

  if (ui.removeBg.checked) {
    const image = context.getImageData(0, 0, canvas.width, canvas.height);

    for (let i = 0; i < image.data.length; i += 4) {
      const r = image.data[i];
      const g = image.data[i + 1];
      const b = image.data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const luminance = .2126 * r + .7152 * g + .0722 * b;

      if (max - min < 40 && luminance > 176) {
        const fade = Math.max(0, Math.min(1, (246 - luminance) / 70));
        image.data[i + 3] = Math.round(image.data[i + 3] * fade);
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
  const padding = 60;
  const maxWidth = canvas.width - padding * 2;
  const maxHeight = canvas.height - padding * 2;

  const ratio = Math.min(
    maxWidth / source.width,
    maxHeight / source.height
  );

  const width = source.width * ratio;
  const height = source.height * ratio;

  context.translate(512, 512);
  context.scale(ui.flip.checked ? -1 : 1, 1);
  context.globalAlpha = Math.min(1, Number(ui.ink.value) / 100);
  context.drawImage(source, -width / 2, -height / 2, width, height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(
    8,
    renderer.capabilities.getMaxAnisotropy()
  );
  texture.needsUpdate = true;

  return texture;
}

function rebuildDecal() {
  clearDecals();

  if (!ready || !tattooImage || !selectedHit) {
    $('t3Before').disabled = true;
    return false;
  }

  // Если модель была переключена, не используем hit от старого mesh.
  if (!bodyMeshes.includes(selectedHit.object)) {
    selectedHit = null;
    $('t3Before').disabled = true;
    return false;
  }

  const texture = makeTattooTexture();
  if (!texture) return false;

  const aspect =
    tattooImage.naturalWidth / tattooImage.naturalHeight || 1;

  const scale = Number(ui.scale.value) / 100;
  const base = .82 * scale;

  let width = base * Math.sqrt(aspect);
  let height = base / Math.sqrt(aspect);

  const wrap = Number(ui.wrap.value);
  width *= .74 + wrap / 230;

  // Глубина проектора позволяет decal лучше огибать округлую поверхность.
  const depth = Math.max(.48, width * (.48 + wrap / 260));

  const position = selectedHit.point.clone();
  position.y += Number(ui.vertical.value) / 100 * .72;
  position.addScaledVector(selectedHit.normal, .01);

  const helper = new THREE.Object3D();
  helper.position.copy(position);
  helper.lookAt(position.clone().add(selectedHit.normal));
  helper.rotateZ(
    THREE.MathUtils.degToRad(Number(ui.rotation.value))
  );

  const size = new THREE.Vector3(width, height, depth);

  let geometry;
  try {
    geometry = new DecalGeometry(
      selectedHit.object,
      position,
      helper.rotation,
      size
    );
  } catch (error) {
    console.error('Decal build error:', error);
    toast('Не удалось построить тату в этой точке');
    texture.dispose();
    return false;
  }

  if (!geometry.attributes.position?.count) {
    geometry.dispose();
    texture.dispose();
    toast('Выберите другое место на коже');
    return false;
  }

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    opacity: Number(ui.opacity.value) / 100,
    alphaTest: .008,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -6,
    roughness: .92,
    metalness: 0,
    side: THREE.DoubleSide
  });

  // Тату меньше реагирует как "глянцевая наклейка".
  material.color.set(0xe6e6e6);

  const decal = new THREE.Mesh(geometry, material);
  decal.renderOrder = 3;

  decalGroup.add(decal);
  $('t3Before').disabled = false;

  return true;
}

function loadTattoo(file) {
  if (!file) return;

  const allowedMime = [
    'image/png',
    'image/jpeg',
    'image/webp'
  ];

  const extensionOk = /\.(png|jpe?g|webp)$/i.test(file.name || '');

  if (!allowedMime.includes(file.type) && !extensionOk) {
    toast('Выберите PNG, JPG или WebP');
    ui.file.value = '';
    return;
  }

  if (file.size > 20 * 1024 * 1024) {
    toast('Файл слишком большой. Максимум 20 МБ.');
    ui.file.value = '';
    return;
  }

  const image = new Image();
  const url = URL.createObjectURL(file);

  image.onload = () => {
    tattooImage = image;
    ui.fileName.textContent = file.name;

    // Сначала пытаемся поставить по центру текущей области.
    if (!selectedHit) {
      const placed = placeFromCameraCenter(true);

      if (!placed) {
        URL.revokeObjectURL(url);
        toast('Эскиз загружен. Нажмите на место на теле.');
        return;
      }
    }

    const ok = rebuildDecal();

    URL.revokeObjectURL(url);

    if (ok && decalGroup.children.length) {
      toast('Эскиз нанесён на тело');
    } else {
      toast('Эскиз загружен. Нажмите на место на коже.');
    }
  };

  image.onerror = () => {
    URL.revokeObjectURL(url);
    ui.file.value = '';
    toast('Не удалось открыть изображение');
  };

  image.src = url;
}

function resize() {
  if (!renderer) return;

  const host = $('t3Viewport');
  const width = Math.max(1, host.clientWidth);
  const height = Math.max(1, host.clientHeight);

  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function bindEvents() {
  ui.gender.addEventListener('change', () => {
    loadModel(ui.gender.value);
  });

  ui.file.addEventListener('change', event => {
    const file = event.target.files?.[0];
    loadTattoo(file);
  });

  [ui.removeBg, ui.flip].forEach(element => {
    element.addEventListener('change', rebuildDecal);
  });

  [ui.scale, ui.rotation, ui.vertical, ui.wrap, ui.opacity, ui.ink]
    .forEach(element => {
      element.addEventListener('input', () => {
        updateLabels();
        rebuildDecal();
      });
    });

  ui.angle.addEventListener('input', () => {
    updateLabels();
    setZone(currentZone, true);
  });

  app.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => {
      setView(button.dataset.view);
    });
  });

  app.querySelectorAll('[data-zone]').forEach(button => {
    button.addEventListener('click', () => {
      ui.angle.value = button.dataset.angle || 50;
      updateLabels();
      setZone(button.dataset.zone, true);
    });
  });

  renderer.domElement.addEventListener('pointerdown', event => {
    pointerStart = {
      x: event.clientX,
      y: event.clientY
    };
  });

  renderer.domElement.addEventListener('pointerup', event => {
    if (!pointerStart) return;

    const distance = Math.hypot(
      event.clientX - pointerStart.x,
      event.clientY - pointerStart.y
    );

    pointerStart = null;

    // Если пользователь вращал модель, не считаем это выбором точки.
    if (distance > 7 || !ready || !bodyMeshes.length) return;

    const rect = renderer.domElement.getBoundingClientRect();

    const mouse = new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1
    );

    const hit = getRayHit(mouse);

    if (!hit) {
      toast('Попробуйте нажать точно на поверхность кожи');
      return;
    }

    storeHit(hit);

    if (tattooImage) {
      if (rebuildDecal()) {
        toast('Татуировка перемещена');
      }
    } else {
      toast('Место выбрано — теперь загрузите эскиз');
    }
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
  ['pointerup', 'pointerleave', 'pointercancel']
    .forEach(type => before.addEventListener(type, show));

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
      if (!blob) {
        toast('Не удалось сохранить ракурс');
        return;
      }

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
