// main.js (en la raíz del repo)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GUI } from 'three/addons/libs/lil-gui.module.min.js';
import { ARButton } from 'three/addons/webxr/ARButton.js';

let scene, camera, renderer, mixer, model;
let ground;
const clock = new THREE.Clock();

const actions = {};
let activeAction;
const params = { animation: 'mutant' };

// AR / WebXR
let controller, reticle;
let hitTestSource = null;
let hitTestSourceRequested = false;

// HUD
const hud = document.getElementById('hud');

init();
animate();

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd0e0f0);

  camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    2000
  );
  camera.position.set(0, 250, 600); // un poco más lejos

  // Luces
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 2);
  hemiLight.position.set(0, 200, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xffffff, 2);
  dirLight.position.set(0, 200, 100);
  dirLight.castShadow = true;
  scene.add(dirLight);

  // Piso (solo modo normal, se oculta en AR)
  ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2000, 2000),
    new THREE.MeshPhongMaterial({ color: 0x444444, depthWrite: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.xr.enabled = true;
  document.body.appendChild(renderer.domElement);

  // Botón AR
  document.body.appendChild(
    ARButton.createButton(renderer, {
      requiredFeatures: ['hit-test']
    })
  );

  // Mostrar/ocultar HUD solo en sesión AR
  renderer.xr.addEventListener('sessionstart', () => {
    hud.style.display = 'flex';
  });
  renderer.xr.addEventListener('sessionend', () => {
    hud.style.display = 'none';
  });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 100, 0);
  controls.update();

  // Retícula AR
  reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x00ff00 })
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  controller = renderer.xr.getController(0);
  controller.addEventListener('select', onSelect);
  scene.add(controller);

  // Loader FBX
  const loader = new FBXLoader();

  loader.load('models/fbx/Mutant Right Turn 45.fbx', (obj) => {
    obj.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });

    scene.add(obj);
    normalizeModel(obj); // ajusta tamaño y distancia

    model = obj;
    mixer = new THREE.AnimationMixer(model);

    if (obj.animations.length > 0) {
      const action = mixer.clipAction(obj.animations[0]);
      actions['mutant'] = action;
      activeAction = action;
      activeAction.play();
    }

    loadAnimation(loader, 'Goalkeeper Scoop.fbx', 'goalkeeper');
    loadAnimation(loader, 'Jumping Down.fbx', 'jump');
    loadAnimation(loader, 'Praying.fbx', 'pray');
    loadAnimation(loader, 'Sitting Clap.fbx', 'clap');

    const gui = new GUI();
    gui
      .add(params, 'animation', ['mutant', 'goalkeeper', 'jump', 'pray', 'clap'])
      .name('Animación')
      .onChange((value) => fadeToAction(value));

    setupAnimationButtons();
  });

  // Teclas para cambiar movimientos
  document.addEventListener('keydown', (event) => {
    switch (event.key) {
      case '1':
        changeAnim('mutant');
        break;
      case '2':
        changeAnim('goalkeeper');
        break;
      case '3':
        changeAnim('jump');
        break;
      case '4':
        changeAnim('pray');
        break;
      case '5':
        changeAnim('clap');
        break;
    }
  });

  window.addEventListener('resize', onWindowResize);
}

// Botones HUD para cambiar animación
function setupAnimationButtons() {
  const buttons = document.querySelectorAll('#hud [data-anim]');
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const anim = btn.getAttribute('data-anim');
      changeAnim(anim);
    });
  });
}

function changeAnim(name) {
  fadeToAction(name);
  params.animation = name;
}

// Colocar el modelo donde está la retícula al tocar en AR
function onSelect() {
  if (reticle.visible && model) {
    model.position.setFromMatrixPosition(reticle.matrix);
  }
}

// Cargar animaciones adicionales
function loadAnimation(loader, file, key) {
  loader.load(`models/fbx/${file}`, (animObj) => {
    if (animObj.animations.length > 0) {
      const action = mixer.clipAction(animObj.animations[0]);
      actions[key] = action;
    }
  });
}

// Normalizar tamaño y posición del modelo (más pequeño para AR)
function normalizeModel(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  obj.position.sub(center); // centrar

  const maxAxis = Math.max(size.x, size.y, size.z);
  const targetHeight = 1.6; // ~1.6m de alto en AR
  obj.scale.multiplyScalar(targetHeight / maxAxis);

  const newBox = new THREE.Box3().setFromObject(obj);
  const newSize = newBox.getSize(new THREE.Vector3());

  obj.position.y = newSize.y / 2;

  const newCenter = newBox.getCenter(new THREE.Vector3());
  const distanceFactor = 3.5;
  camera.position.set(
    newCenter.x,
    newCenter.y + newSize.y * 1.2,
    newCenter.z + newSize.z * distanceFactor
  );
  camera.lookAt(new THREE.Vector3(0, newSize.y / 2, 0));
}

// Transición entre animaciones
function fadeToAction(name) {
  const newAction = actions[name];
  if (newAction && newAction !== activeAction) {
    if (activeAction) activeAction.fadeOut(0.5);
    newAction.reset().fadeIn(0.5).play();
    activeAction = newAction;
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Loop de render + lógica AR
function animate() {
  renderer.setAnimationLoop(render);
}

function render(timestamp, frame) {
  const delta = clock.getDelta();
  if (mixer) mixer.update(delta);

  const session = renderer.xr.getSession();

  // Ocultar el piso cuando está en AR
  ground.visible = !renderer.xr.isPresenting;

  if (frame && session) {
    const referenceSpace = renderer.xr.getReferenceSpace();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((source) => {
          hitTestSource = source;
        });

        session.addEventListener('end', () => {
          hitTestSourceRequested = false;
          hitTestSource = null;
          reticle.visible = false;
          ground.visible = true;
        });
      });

      hitTestSourceRequested = true;
    }

    if (hitTestSource) {
      const hitTestResults = frame.getHitTestResults(hitTestSource);
      if (hitTestResults.length) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(referenceSpace);

        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  renderer.render(scene, camera);
}
