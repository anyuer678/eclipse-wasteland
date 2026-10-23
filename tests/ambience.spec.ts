import { describe, it, expect } from 'vitest'
import { MOODS } from '../src/play/ambience'
import { MISSIONS } from '../src/campaign/missions'

describe('play/ambience', () => {
  it('has a music mood for every mission map', () => {
    for (const m of MISSIONS) {
      expect(MOODS[m.mapId], `missing mood for ${m.mapId}`).toBeTruthy()
    }
  })

  it('uses a sane root and scale', () => {
    for (const [root, scale] of Object.values(MOODS)) {
      expect(root).toBeGreaterThan(20)
      expect(root).toBeLessThan(200)
      expect(scale.length).toBeGreaterThanOrEqual(3)
    }
  })
})
