import type { Instance } from './scatter'

/** Writes compose(position, quat, scale) per instance, column-major like three's Matrix4.elements. */
export function writeInstanceMatrices(instances: Instance[], out: Float32Array): void {
  for (let k = 0; k < instances.length; k++) {
    const { x: px, y: py, z: pz, quat, scale } = instances[k]
    const [x, y, z, w] = quat
    const [sx, sy, sz] = scale
    const x2 = x + x, y2 = y + y, z2 = z + z
    const xx = x * x2, xy = x * y2, xz = x * z2
    const yy = y * y2, yz = y * z2, zz = z * z2
    const wx = w * x2, wy = w * y2, wz = w * z2
    const o = k * 16
    out[o] = (1 - (yy + zz)) * sx
    out[o + 1] = (xy + wz) * sx
    out[o + 2] = (xz - wy) * sx
    out[o + 3] = 0
    out[o + 4] = (xy - wz) * sy
    out[o + 5] = (1 - (xx + zz)) * sy
    out[o + 6] = (yz + wx) * sy
    out[o + 7] = 0
    out[o + 8] = (xz + wy) * sz
    out[o + 9] = (yz - wx) * sz
    out[o + 10] = (1 - (xx + yy)) * sz
    out[o + 11] = 0
    out[o + 12] = px
    out[o + 13] = py
    out[o + 14] = pz
    out[o + 15] = 1
  }
}
