import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ARENA_HALF, ARENA_WALL_H, ARENA_WALL_T, DEFAULT_POSE, JOINT_NAMES, SPAWN, TIMESTEP } from './constants.js';

const elements = (parent, name) => Array.from(parent.getElementsByTagName(name));
let preparedAssets;
const copyAssets = ({ xml, meshes }) => ({ xml, meshes: meshes.map(({ name, bytes }) => ({ name, bytes: bytes.slice(0) })) });

// Same preparation as the official Sandbox, with only the flat walking
// arena. Decorative geometry never enters this XML or the MuJoCo VFS.
export function preparePhysicsXml(source) {
  const doc = new DOMParser().parseFromString(source, 'text/xml');
  if (elements(doc, 'parsererror').length || doc.documentElement.tagName !== 'mujoco') throw new Error('Invalid playground robot XML.');
  const root = doc.documentElement, asset = elements(root, 'asset')[0], world = elements(root, 'worldbody')[0];
  const el = (tag, attrs) => {
    const node = doc.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  };
  for (const geom of elements(world, 'geom')) if (geom.getAttribute('class') === 'visual') geom.parentNode.removeChild(geom);
  const used = new Set(elements(world, 'geom').map(geom => geom.getAttribute('mesh')).filter(Boolean));
  for (const mesh of elements(asset, 'mesh')) {
    if (!used.has(mesh.getAttribute('name') || mesh.getAttribute('file').replace(/\.stl$/i, ''))) mesh.parentNode.removeChild(mesh);
  }
  let option = elements(root, 'option')[0];
  if (!option) { option = el('option', {}); root.appendChild(option); }
  option.setAttribute('timestep', String(TIMESTEP));
  world.appendChild(el('geom', { name: 'floor', type: 'plane', size: '0 0 0.05', pos: '0 0 0' }));
  const ht = ARENA_WALL_T / 2, hh = ARENA_WALL_H / 2, off = ARENA_HALF + ht, span = ARENA_HALF + ARENA_WALL_T;
  for (const [name, pos, size] of [
    ['wall_px', [off, 0, hh], [ht, span, hh]], ['wall_nx', [-off, 0, hh], [ht, span, hh]],
    ['wall_py', [0, off, hh], [span, ht, hh]], ['wall_ny', [0, -off, hh], [span, ht, hh]],
  ]) world.appendChild(el('geom', { name, type: 'box', pos: pos.join(' '), size: size.join(' ') }));
  const pose = new Map(JOINT_NAMES.map((name, i) => [name, DEFAULT_POSE[i]]));
  const joints = elements(world, 'joint');
  if (joints.length !== JOINT_NAMES.length || joints.some(joint => !pose.has(joint.getAttribute('name')))) throw new Error('Unexpected playground joint layout.');
  const keyframe = el('keyframe', {});
  keyframe.appendChild(el('key', {
    name: 'STAND', qpos: [...SPAWN, 1, 0, 0, 0, ...joints.map(joint => pose.get(joint.getAttribute('name')))].join(' '),
    ctrl: Array.from(DEFAULT_POSE).join(' '),
  }));
  root.appendChild(keyframe);
  return { xml: new XMLSerializer().serializeToString(doc), meshFiles: elements(asset, 'mesh').map(mesh => mesh.getAttribute('file')) };
}

// The official browser demo reconstructs its collision STL from this GLB.
// Use the identical triangles, rather than DuckRobe's different native STL.
export function geometryToBinaryStl(geometry) {
  const pos = geometry.attributes.position, indices = geometry.index;
  const count = (indices ? indices.count : pos.count) / 3;
  const bytes = new ArrayBuffer(84 + count * 50), view = new DataView(bytes);
  view.setUint32(80, count, true);
  for (let t = 0, offset = 84; t < count; t++, offset += 50) {
    const a = indices ? indices.getX(t * 3) : t * 3;
    const b = indices ? indices.getX(t * 3 + 1) : t * 3 + 1;
    const c = indices ? indices.getX(t * 3 + 2) : t * 3 + 2;
    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
    const cx = pos.getX(c), cy = pos.getY(c), cz = pos.getZ(c);
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const length = Math.hypot(nx, ny, nz) || 1;
    view.setFloat32(offset, nx / length, true); view.setFloat32(offset + 4, ny / length, true); view.setFloat32(offset + 8, nz / length, true);
    view.setFloat32(offset + 12, ax, true); view.setFloat32(offset + 16, ay, true); view.setFloat32(offset + 20, az, true);
    view.setFloat32(offset + 24, bx, true); view.setFloat32(offset + 28, by, true); view.setFloat32(offset + 32, bz, true);
    view.setFloat32(offset + 36, cx, true); view.setFloat32(offset + 40, cy, true); view.setFloat32(offset + 44, cz, true);
  }
  return bytes;
}

export async function loadPhysicsAssets(baseUrl, signal) {
  signal?.throwIfAborted();
  // Keep only one successful immutable model, never a failed/loading promise.
  // Each worker owns transferred copies; cached buffers must stay attached.
  if (preparedAssets?.baseUrl === baseUrl) return copyAssets(preparedAssets);
  const fetchAsset = async name => {
    const response = await fetch(new URL(name, baseUrl), { signal });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response;
  };
  const [source, glb] = await Promise.all([
    fetchAsset('robot.xml').then(r => r.text()), fetchAsset('collision-source.glb').then(r => r.arrayBuffer()),
  ]);
  signal?.throwIfAborted();
  const { xml, meshFiles } = preparePhysicsXml(source);
  const gltf = await new GLTFLoader().parseAsync(glb, '');
  const geometries = new Map(), meshes = [];
  gltf.scene.traverse(node => { if (node.isMesh) geometries.set(node.userData.meshFile || node.name, node.geometry); });
  try {
    for (const name of meshFiles) {
      const geometry = geometries.get(name);
      if (!geometry) throw new Error(`Missing official collision mesh: ${name}`);
      meshes.push({ name: `assets/${name}`, bytes: geometryToBinaryStl(geometry) });
    }
    signal?.throwIfAborted();
    preparedAssets = { baseUrl, xml, meshes };
    return copyAssets(preparedAssets);
  } finally {
    gltf.scene.traverse(node => { if (node.isMesh) { node.geometry.dispose(); (Array.isArray(node.material) ? node.material : [node.material]).forEach(m => m.dispose()); } });
  }
}
