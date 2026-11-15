// Demo-Song, komplett im Browser synthetisiert: „Ode an die Freude" (Beethoven/Schiller, gemeinfrei).
// „Gesang" liegt mittig, Begleitung links/rechts – so lässt sich die Gesangstrennung sofort ausprobieren.
import type { LyricLine, Song } from './types'
import { encodeWav } from './wav'

const BEAT = 0.6
const INTRO = 8 * BEAT
const E = 64, F = 65, G = 67, D = 62, C = 60
const A1: [number, number][] = [[E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1]]
const A2: [number, number][] = [[C, 1], [C, 1], [D, 1], [E, 1], [E, 1.5], [D, 0.5], [D, 2]]
const A4: [number, number][] = [[C, 1], [C, 1], [D, 1], [E, 1], [D, 1.5], [C, 0.5], [C, 2]]
const VERSE = [...A1, ...A2, ...A1, ...A4]

export interface DemoNote { t: number; dur: number; midi: number }
export const DEMO_NOTES: DemoNote[] = (() => {
  const out: DemoNote[] = []
  let t = INTRO
  for (let v = 0; v < 2; v++) for (const [m, b] of VERSE) { out.push({ t, dur: b * BEAT, midi: m }); t += b * BEAT }
  return out
})()

const TEXT = [
  'Freude, schöner Götterfunken,', 'Tochter aus Elysium,', 'Wir betreten feuertrunken,', 'Himmlische, dein Heiligtum!',
  'Deine Zauber binden wieder,', 'Was die Mode streng geteilt;', 'Alle Menschen werden Brüder,', 'Wo dein sanfter Flügel weilt.',
]
export const DEMO_LYRICS: LyricLine[] = TEXT.map((text, i) => ({ t: INTRO + i * 8 * BEAT, text }))

const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)

export async function buildDemoSong(): Promise<Song> {
  const sr = 44100
  const total = INTRO + 64 * BEAT + 3
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr)

  // „Gesang": Sägezahn + Formant-Tiefpass + Vibrato, exakt mittig
  const vf = ctx.createBiquadFilter(); vf.type = 'lowpass'; vf.frequency.value = 1700; vf.Q.value = 1.2
  vf.connect(ctx.destination)
  for (const n of DEMO_NOTES) {
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(n.midi)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 5.5
    const lg = ctx.createGain(); lg.gain.setValueAtTime(0, n.t); lg.gain.linearRampToValueAtTime(22, n.t + 0.25)
    lfo.connect(lg).connect(o.detune)
    const g = ctx.createGain()
    const end = n.t + n.dur - 0.06
    g.gain.setValueAtTime(0, n.t); g.gain.linearRampToValueAtTime(0.22, n.t + 0.04)
    g.gain.setValueAtTime(0.22, end); g.gain.linearRampToValueAtTime(0, end + 0.05)
    o.connect(g).connect(vf)
    o.start(n.t); o.stop(end + 0.06); lfo.start(n.t); lfo.stop(end + 0.06)
  }

  // Begleitung: Fläche links, Zupfer rechts, Bass + Bassdrum mittig (tief)
  const left = ctx.createStereoPanner(); left.pan.value = -1; left.connect(ctx.destination)
  const right = ctx.createStereoPanner(); right.pan.value = 1; right.connect(ctx.destination)
  const CH = { C: [48, 55, 72, 76, 79, 36], G: [47, 55, 74, 79, 83, 43] } // [pad1, pad2, arp…, bass]
  const halfBars = total / (2 * BEAT)
  for (let h = 0; h < halfBars - 1; h++) {
    const t = h * 2 * BEAT
    const inVerse = (h - 4 + 160) % 16
    const chord = h < 4 ? (h < 2 ? CH.C : CH.G) : inVerse % 4 >= 2 && inVerse !== 15 ? CH.G : CH.C
    for (const m of chord.slice(0, 2)) {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(m)
      const g = ctx.createGain()
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.08)
      g.gain.setValueAtTime(0.16, t + 2 * BEAT - 0.1); g.gain.linearRampToValueAtTime(0, t + 2 * BEAT)
      o.connect(g).connect(left); o.start(t); o.stop(t + 2 * BEAT)
    }
    for (let k = 0; k < 4; k++) {
      const tt = t + k * BEAT / 2
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = hz(chord[2 + (k % 3)])
      const g = ctx.createGain()
      g.gain.setValueAtTime(0.14, tt); g.gain.exponentialRampToValueAtTime(0.001, tt + 0.28)
      o.connect(g).connect(right); o.start(tt); o.stop(tt + 0.3)
    }
    const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = hz(chord[5])
    const bg = ctx.createGain()
    bg.gain.setValueAtTime(0, t); bg.gain.linearRampToValueAtTime(0.3, t + 0.03)
    bg.gain.setValueAtTime(0.3, t + 2 * BEAT - 0.15); bg.gain.linearRampToValueAtTime(0, t + 2 * BEAT - 0.02)
    b.connect(bg).connect(ctx.destination); b.start(t); b.stop(t + 2 * BEAT)
    const k = ctx.createOscillator(); k.frequency.setValueAtTime(110, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.12)
    const kg = ctx.createGain(); kg.gain.setValueAtTime(0.5, t); kg.gain.exponentialRampToValueAtTime(0.001, t + 0.2)
    k.connect(kg).connect(ctx.destination); k.start(t); k.stop(t + 0.22)
  }

  const buf = await ctx.startRendering()
  const audio = encodeWav([buf.getChannelData(0), buf.getChannelData(1)], sr)
  return {
    id: 'demo-ode', title: 'Ode an die Freude', artist: 'Demo · Beethoven / Schiller', duration: total,
    addedAt: 0, audio, lyrics: DEMO_LYRICS, favorite: false, playCount: 0, isDemo: true,
  }
}
