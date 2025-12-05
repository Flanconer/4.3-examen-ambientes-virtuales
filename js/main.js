// main.js (en la raíz del repo)
// Modelos en: ./models/fbx/Mutant Right Turn 45.fbx, etc.

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

// Botones inmersivos 3D
let buttonsGroup;
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();

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

  // Piso (solo modo normal, se ocultará en AR)
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
    normalizeModel(obj); // escala y aleja

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

    // Crear botones inmersivos alrededor del personaje
    createImmersiveButtons();
  });

  // Teclas para cambiar movimientos (modo normal)
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

// Botones 3D inmersivos, flotando frente al modelo
function createImmersiveButtons() {
  if (!model) return;

  buttonsGroup = new THREE.Group();
  model.add(buttonsGroup); // se mueven junto con el personaje

  const radius = 0.06; // tamaño del botón (metros aprox.)
  const geo = new THREE.SphereGeometry(radius, 16, 16);

  function addButton(x, y, z, color, animName) {
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.anim = animName;
    buttonsGroup.add(mesh);
  }

  // fila de botones frente al pecho del personaje
  const z = 0.45;   // delante del modelo
  const y = 1.2;    // altura aprox. del pecho

  addButton(-0.30, y, z, 0x00ff00, 'mutant');
  addButton(-0.15, y, z, 0x0000ff, 'goalkeeper');
  addButton( 0.00, y, z, 0xffff00, 'jump');
  addButton( 0.15, y, z, 0xff00ff, 'pray');
  addButton( 0.30, y, z, 0xff0000, 'clap');
}

function changeAnim(name) {
  fadeToAction(name);
  params.animation = name;
}

// Colocar modelo o activar botones al tocar en AR
function onSelect() {
  // 1) Revisar si se tocó un botón inmersivo
  if (buttonsGroup) {
    tempMatrix.identity().extractRotation(controller.matrixWorld);
    raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);

    const intersects = raycaster.intersectObjects(buttonsGroup.children, true);
    if (intersects.length > 0) {
      const animName = intersects[0].object.userData.anim;
      if (animName) {
        changeAnim(animName);
        return; // no reposicionar el modelo
      }
    }
  }

  // 2) Si no se tocó botón, usar la retícula para colocar el modelo
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

// Normalizar tamaño y posición del modelo (escala para AR)
function normalizeModel(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());

  obj.position.sub(center); // centrar en el origen

  const maxAxis = Math.max(size.x, size.y, size.z);
  const targetHeight = 1.6; // ~1.6 m de alto
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

  // Ocultar piso en modo AR
  ground.visible = !renderer.xr.isPresenting;

  if (frame && session) {
    const referenceSpace = renderer.xr.getReferenceSpace();

    if (!hitTestSourceRequested) {
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session
          .requestHitTestSource({ space: viewerSpace })
          .then((source) => {
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
