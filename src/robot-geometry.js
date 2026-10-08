import { BufferAttribute } from 'three';

// Crease normals split every triangle corner. Share only vertices whose
// position AND normal words match exactly, preserving hard edges and every
// original triangle. Do this once, before a prepared geometry is shared.
export function indexRobotGeometry(geometry) {
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (geometry.index || Object.keys(geometry.attributes).sort().join(',') !== 'normal,position' ||
      Object.keys(geometry.morphAttributes).length || ![position, normal].every(attribute =>
        attribute.itemSize === 3 && attribute.array instanceof Float32Array && !attribute.isInterleavedBufferAttribute)) return geometry;
  if (position.count !== normal.count) return geometry;
  const positions = new Uint32Array(position.array.buffer, position.array.byteOffset, position.array.length);
  const normals = new Uint32Array(normal.array.buffer, normal.array.byteOffset, normal.array.length);
  const heads = new Map(), retained = new Uint32Array(position.count);
  const next = new Int32Array(position.count), indices = new Uint32Array(position.count);
  let count = 0;
  for (let vertex = 0; vertex < position.count; vertex++) {
    const p = vertex * 3;
    let hash = 2166136261;
    for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ positions[p + c], 16777619);
    for (let c = 0; c < 3; c++) hash = Math.imul(hash ^ normals[p + c], 16777619);
    let source = heads.get(hash) ?? -1, index;
    // Hash collisions must compare the full six words before sharing.
    while (source !== -1) {
      const s = source * 3;
      if (positions[p] === positions[s] && positions[p + 1] === positions[s + 1] && positions[p + 2] === positions[s + 2] &&
          normals[p] === normals[s] && normals[p + 1] === normals[s + 1] && normals[p + 2] === normals[s + 2]) {
        index = indices[source]; break;
      }
      source = next[source];
    }
    if (index === undefined) {
      index = count; retained[count++] = vertex;
      next[vertex] = heads.get(hash) ?? -1; heads.set(hash, vertex);
    }
    indices[vertex] = index;
  }
  for (const [name, words] of [['position', positions], ['normal', normals]]) {
    const packed = new Float32Array(count * 3), packedWords = new Uint32Array(packed.buffer);
    for (let i = 0; i < count; i++) {
      const s = retained[i] * 3, p = i * 3;
      packedWords[p] = words[s]; packedWords[p + 1] = words[s + 1]; packedWords[p + 2] = words[s + 2];
    }
    const original = geometry.getAttribute(name), attribute = new BufferAttribute(packed, 3, original.normalized);
    attribute.name = original.name; attribute.setUsage(original.usage);
    geometry.setAttribute(name, attribute);
  }
  // WebGL2 reserves Uint16's 65535 value for primitive restart.
  geometry.setIndex(new BufferAttribute(count <= 65535 ? new Uint16Array(indices) : indices, 1));
  return geometry;
}
