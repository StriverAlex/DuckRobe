import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadRobot } from '../src/robot.js';
import { indexRobotGeometry } from '../src/robot-geometry.js';

globalThis.fetch = async url => new Response(await readFile(`public${url}`));
const rig = await loadRobot(), prepared = new Map();
rig.group.traverse(mesh => { if (mesh.isMesh) prepared.set(mesh.userData.meshFile, mesh.geometry); });
const glb = await readFile('public/robot/web/microduck.glb');
const source = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength), '');
const bytes = array => Buffer.from(array.buffer, array.byteOffset, array.byteLength);
const memory = geometry => Object.values(geometry.attributes).reduce((sum, attribute) => sum + attribute.array.byteLength, geometry.index?.array.byteLength || 0);
const totals = { meshes: 0, beforeVertices: 0, afterVertices: 0, beforeBytes: 0, afterBytes: 0 };
source.scene.traverse(mesh => {
  if (!mesh.isMesh) return;
  // Reproduce the original shading pipeline as an independent reference,
  // then compare every expanded triangle corner, including normal bit patterns.
  const scaled = mesh.geometry.clone(); scaled.deleteAttribute('normal'); scaled.scale(1000, 1000, 1000);
  const before = toCreasedNormals(scaled, Math.PI / 5); before.scale(.001, .001, .001); before.computeBoundingBox();
  const after = prepared.get(mesh.userData.meshFile || mesh.name); assert(after?.index);
  const expanded = after.toNonIndexed();
  for (const name of ['position', 'normal']) assert(bytes(before.getAttribute(name).array).equals(bytes(expanded.getAttribute(name).array)), `${mesh.name}: ${name} triangle stream changed`);
  assert.deepEqual(after.boundingBox, before.boundingBox); assert.deepEqual(after.groups, before.groups);
  assert.deepEqual(after.drawRange, before.drawRange);
  totals.meshes++; totals.beforeVertices += before.getAttribute('position').count; totals.afterVertices += after.getAttribute('position').count;
  totals.beforeBytes += memory(before); totals.afterBytes += memory(after);
  expanded.dispose(); before.dispose(); scaled.dispose();
});
assert.equal(totals.meshes, 38); assert(totals.afterVertices < totals.beforeVertices); assert(totals.afterBytes < totals.beforeBytes);
console.log('PASS all 38 prepared CAD meshes retain exact triangle positions, normals, bounds and draw ranges');
console.log(JSON.stringify(totals));

// Distinct shading at one position must keep separate vertices, including -0.
const corners = new BufferGeometry();
corners.setAttribute('position', new Float32BufferAttribute(Array(18).fill(0), 3));
corners.setAttribute('normal', new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, -0, 0, 1, 0, 1, 0, 0, 1, 0], 3));
const expected = corners.clone(); corners.addGroup(0, 3, 0); corners.setDrawRange(0, 3);
indexRobotGeometry(corners);
assert.equal(corners.getAttribute('position').count, 3);
assert(bytes(corners.toNonIndexed().getAttribute('normal').array).equals(bytes(expected.getAttribute('normal').array)));
assert.deepEqual(corners.groups, [{ start: 0, count: 3, materialIndex: 0 }]); assert.deepEqual(corners.drawRange, { start: 0, count: 3 });

// Future denser parts must not overflow a 16-bit index.
for (const count of [65535, 65536, 65538]) {
  const dense = new BufferGeometry(), positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) positions[i * 3] = i;
  dense.setAttribute('position', new Float32BufferAttribute(positions, 3));
  dense.setAttribute('normal', new Float32BufferAttribute(new Float32Array(positions.length), 3));
  indexRobotGeometry(dense);
  assert(dense.index.array instanceof (count === 65535 ? Uint16Array : Uint32Array)); assert.equal(dense.index.getX(count - 1), count - 1);
  assert(bytes(dense.toNonIndexed().getAttribute('position').array).equals(bytes(positions)));
}
console.log('PASS separate hard-edge normals, signed zero and 32-bit index range');
