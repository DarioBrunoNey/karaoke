// Prüft die Bewertungslogik mit synthetischen Auftritten: node --experimental-strip-types tests/scoring.test.ts
import assert from 'node:assert/strict'
import { ScoreSession } from '../src/lib/scoring.ts'
import { extractMelody } from '../src/audio/melody.ts'
import { foldSemis } from '../src/lib/pitch.ts'

const fps = 50
// Referenz: 8 Phrasen à 3 s Gesang (wechselnde Töne) + 1 s Pause
const ref = new Float32Array(fps * 32)
const notes = [60, 62, 64, 65, 67, 65, 64, 62]
for (let p = 0; p < 8; p++) for (let i = 0; i < 3 * fps; i++) ref[p * 4 * fps + i] = notes[(p + Math.floor(i / 25)) % 8]
const melody = { fps, data: ref, source: 'stems' as const }

function perform(fn: (i: number, r: number) => number, upTo = ref.length) {
  const s = new ScoreSession(melody)
  for (let i = 0; i < upTo; i++) s.add(i / fps, fn(i, ref[i]))
  return s.result()
}
let seed = 7
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

const perfect = perform((_, r) => r)
const octaveDown = perform((_, r) => (r ? r - 12 : 0))
const slightlyOff = perform((_, r) => (r ? r + 1.3 : 0))
const wrongKey = perform((_, r) => (r ? r + 4 : 0))
const drone = perform((_, r) => (r ? 61.3 : 0))
const silent = perform(() => 0)
const late = perform((i) => (i >= 20 && ref[i - 20] ? ref[i - 20] : 0))
const always = perform((_, r) => r || 60)
const half = perform((_, r) => r, ref.length / 4)

const show = (n: string, r: ReturnType<typeof perform>) => console.log(n.padEnd(14), String(r.total).padStart(3), JSON.stringify(r.parts), 'acc', r.accuracy, 'valid', r.valid)
show('perfekt', perfect); show('Oktave tiefer', octaveDown); show('leicht daneben', slightlyOff); show('falsche Tonart', wrongKey)
show('Brummer', drone); show('stumm', silent); show('0,4 s zu spät', late); show('Dauersänger', always); show('abgebrochen', half)

assert.ok(perfect.total >= 97, 'perfekter Auftritt')
assert.ok(octaveDown.total >= 97, 'Oktave egal')
assert.ok(slightlyOff.total > 50 && slightlyOff.total < 85)
assert.ok(wrongKey.total < 45 && wrongKey.parts.pitch === 0)
assert.ok(drone.total < 50)
assert.equal(silent.total, 0)
assert.ok(late.parts.timing < 70 && late.total < perfect.total)
assert.ok(always.parts.rhythm < perfect.parts.rhythm)
assert.equal(half.valid, false)
assert.equal(foldSemis(13), 1); assert.equal(foldSemis(-11), 1)

// Melodie-Erkennung: Sägezahn mit Vibrato, 3 Töne
const sr = 44100
const sig = new Float32Array(sr * 3)
const tones = [220, 277.18, 329.63]
let ph = 0
for (let i = 0; i < sig.length; i++) {
  const f = tones[Math.floor(i / sr)] * (1 + 0.01 * Math.sin((2 * Math.PI * 5.5 * i) / sr))
  ph += f / sr
  sig[i] = i % sr > sr * 0.9 ? 0 : 0.3 * (2 * (ph % 1) - 1)
}
const mel = extractMelody(sig, sr)
const at = (t: number) => mel[Math.round(t * 50)]
console.log('Melodie', at(0.5).toFixed(2), at(1.5).toFixed(2), at(2.5).toFixed(2), 'Pause', at(0.96))
assert.ok(Math.abs(at(0.5) - 57) < 0.4 && Math.abs(at(1.5) - 61) < 0.4 && Math.abs(at(2.5) - 64) < 0.4)
assert.equal(at(0.96), 0)
console.log('OK')
