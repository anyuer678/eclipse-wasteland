import { describe, it, expect } from 'vitest'
import { SpatialHash } from '../src/horde/spatialHash'

interface Pt { x: number; z: number }

const randPts = (n: number, seed = 1): Pt[] => {
  let s = seed
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
  return Array.from({ length: n }, () => ({ x: -20 + rnd() * 40, z: -20 + rnd() * 40 }))
}

const hashPairs = (pts: Pt[]): number[] => {
  const h = new SpatialHash(1.5)
  pts.forEach((p, i) => h.insert(i, p.x, p.z))
  return h.pairs()
}

describe('horde/spatialHash', () => {
  it('covers every truly-overlapping pair (radius 1.2) without duplicates', () => {
    const pts = randPts(120, 7)
    const hash = hashPairs(pts)
    const seen = new Set<string>()
    for (let k = 0; k < hash.length; k += 2) {
      const i = hash[k]
      const j = hash[k + 1]
      expect(i).toBeLessThan(j)
      const key = `${i},${j}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 1.2) {
          expect(seen.has(`${i},${j}`)).toBe(true)
        }
      }
    }
  })

  it('keeps working across negative coordinates', () => {
    const pts = [{ x: -3.1, z: -3.1 }, { x: -2.9, z: -3.0 }, { x: 9, z: 9 }]
    const pairs = hashPairs(pts)
    const set = new Set<string>()
    for (let k = 0; k < pairs.length; k += 2) set.add(`${pairs[k]},${pairs[k + 1]}`)
    expect(set.has('0,1')).toBe(true)
  })

  it('is much cheaper than all-pairs on a dense crowd', () => {
    const pts = randPts(400, 11)
    const t0 = performance.now()
    hashPairs(pts)
    const hashMs = performance.now() - t0
    const t1 = performance.now()
    let n = 0
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.hypot(pts[i].x - pts[j].x, pts[i].z - pts[j].z) < 1.2) n++
      }
    }
    const bruteMs = performance.now() - t1
    expect(n).toBeGreaterThan(0)
    expect(hashMs).toBeLessThan(bruteMs)
  })
})
