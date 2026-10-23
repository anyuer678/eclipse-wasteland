import { describe, it, expect } from 'vitest'
import { pickSpawnAnchor } from '../src/campaign/spawnZones'

const anchors = [
  { x: 20, z: 0 },
  { x: 0, z: 20 },
  { x: -20, z: 0 },
  { x: 0, z: -20 },
]

describe('campaign/spawnZones', () => {
  it('rotates anchors in groups, not every enemy', () => {
    const seq = [0, 1, 2, 3, 4, 5, 6]
    const picked = seq.map((s) => pickSpawnAnchor(anchors, s, 3, 0, 0, 0, 100))
    expect(picked[0]).toEqual(anchors[0])
    expect(picked[1]).toEqual(anchors[0])
    expect(picked[2]).toEqual(anchors[0])
    expect(picked[3]).toEqual(anchors[1])
    expect(picked[6]).toEqual(anchors[2])
  })

  it('skips anchors too close or too far from the player', () => {
    const near = pickSpawnAnchor(anchors, 0, 3, 19, 0, 12, 40)
    expect(near).toEqual(anchors[1])
    const found = pickSpawnAnchor(anchors, 0, 3, 0, 0, 30, 40)
    expect(found).toBeNull()
  })

  it('returns null without anchors', () => {
    expect(pickSpawnAnchor([], 0, 3, 0, 0)).toBeNull()
  })
})
