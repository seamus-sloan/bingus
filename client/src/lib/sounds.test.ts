import { afterEach, describe, expect, it, vi } from 'vitest'

function param() {
  return { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }
}

// Just enough AudioContext to schedule sounds against. `resumes: false`
// plays WebKit outside a gesture: resume() is accepted but never starts the
// clock. Returns every context the module creates.
function stubAudio({ resumes }: { resumes: boolean }) {
  const contexts: FakeContext[] = []
  class FakeContext {
    state = 'suspended'
    currentTime = 0
    destination = {}
    oscillators = 0
    constructor() {
      contexts.push(this)
    }
    resume() {
      if (resumes) this.state = 'running'
      return Promise.resolve()
    }
    createOscillator() {
      this.oscillators++
      return { frequency: param(), connect() {}, start() {}, stop() {} }
    }
    createGain() {
      return { gain: param(), connect() {} }
    }
  }
  vi.stubGlobal('AudioContext', FakeContext)
  return contexts
}

// audioCtx and the burst clock are module state, so each test gets a fresh
// copy of the module.
async function loadSounds(audio: { resumes: boolean }) {
  const contexts = stubAudio(audio)
  vi.resetModules()
  return { contexts, ...(await import('./sounds')) }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('playBubble', () => {
  it('never creates the audio context itself', async () => {
    const { contexts, playBubble } = await loadSounds({ resumes: true })
    playBubble()
    expect(contexts).toHaveLength(0)
  })

  it('stays quiet while the context is still suspended', async () => {
    const { contexts, playBubble, unlockAudio } = await loadSounds({
      resumes: false,
    })
    unlockAudio()
    playBubble()
    expect(contexts[0].oscillators).toBe(0)
  })

  it('plays once per burst on a running context', async () => {
    const { contexts, playBubble, unlockAudio } = await loadSounds({
      resumes: true,
    })
    unlockAudio()
    const ctx = contexts[0]
    playBubble()
    expect(ctx.oscillators).toBe(1)
    playBubble()
    expect(ctx.oscillators).toBe(1)
    ctx.currentTime += 0.15
    playBubble()
    expect(ctx.oscillators).toBe(2)
  })
})
