// Tiny synthesized sound effects for the live table. Pure garnish: any
// environment without WebAudio (tests, muted autoplay policies) just stays
// silent.
let audioCtx: AudioContext | null = null

function withAudio(play: (ctx: AudioContext) => void) {
  try {
    audioCtx ??= new AudioContext()
    if (audioCtx.state === 'suspended') void audioCtx.resume()
    play(audioCtx)
  } catch {
    // no audio, no problem
  }
}

/** A celebratory pop on marking a tile. */
export function playPop() {
  withAudio((ctx) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 640
    gain.gain.setValueAtTime(0.1, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.13)
  })
}

// A burst of messages should land as one bloop, not a drumroll.
const BUBBLE_GAP = 0.15
let lastBubbleAt = -Infinity

/**
 * A rising bloop when someone else speaks in chat. It sweeps upward so it
 * never reads as the flat tile pop.
 */
export function playBubble() {
  withAudio((ctx) => {
    // A missed bloop beats a late one: a suspended context would queue it
    // until the next tap.
    if (ctx.state !== 'running') return
    const now = ctx.currentTime
    if (now - lastBubbleAt < BUBBLE_GAP) return
    lastBubbleAt = now
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.setValueAtTime(420, now)
    osc.frequency.exponentialRampToValueAtTime(1250, now + 0.1)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.008)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(now)
    osc.stop(now + 0.18)
  })
}
