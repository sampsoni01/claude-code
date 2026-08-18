// Massing Tool — Phase 1: massing core.
// 1 world unit = 1 foot. See README.md for the model and future hooks.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Store } from './state/store';
import { BuildingView } from './geometry/mesher';
import { Controller } from './interaction/controller';
import { initPanel } from './ui/panel';

const app = document.getElementById('app')!;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfe9f0);
scene.fog = new THREE.Fog(0xdfe9f0, 900, 1600);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.5, 4000);
camera.position.set(160, 130, 160);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 30, 0);
orbit.enableDamping = true;
orbit.dampingFactor = 0.12;
orbit.maxPolarAngle = Math.PI / 2 - 0.02;
orbit.minDistance = 20;
orbit.maxDistance = 1200;

// lighting: deliberately ordinary (see brief) — a sky hemisphere + one sun
scene.add(new THREE.HemisphereLight(0xf4f8ff, 0x9aa48f, 0.9));
const sun = new THREE.DirectionalLight(0xfff2df, 1.6);
sun.position.set(180, 260, 120);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -300;
sun.shadow.camera.right = 300;
sun.shadow.camera.top = 300;
sun.shadow.camera.bottom = -300;
sun.shadow.camera.far = 900;
sun.shadow.bias = -0.0004;
scene.add(sun);

// ground: a soft plane + a 5 ft grid
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2400, 2400).rotateX(-Math.PI / 2),
  new THREE.MeshStandardMaterial({ color: 0xccd3c8, roughness: 1 }),
);
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(500, 100, 0x8d998d, 0xb3bdb0);
(grid.material as THREE.Material).transparent = true;
(grid.material as THREE.Material).opacity = 0.55;
grid.position.y = 0.02;
scene.add(grid);

const store = new Store();
const view = new BuildingView();
scene.add(view.group);

const controller = new Controller(scene, camera, renderer.domElement, orbit, store, view);

store.subscribe(() => {
  view.rebuild(store.building, { helpers: true, selected: store.selected });
});

initPanel(store, controller);

// pick up where the last session left off
if (store.restoreAutosave()) {
  controller.setMode('edit');
  store.notify();
} else {
  controller.setMode('draw');
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  orbit.update();
  renderer.render(scene, camera);
});
