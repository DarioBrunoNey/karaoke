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
const slightlyOff = perform((_, r) => (r ? r + 0.9 : 0))
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
assert.ok(slightlyOff.total > 40 && slightlyOff.total < 75, 'knapp daneben: ' + slightlyOff.total)
{
  // Schwierigkeit: derselbe Auftritt (0,7 Halbtöne daneben) – leicht = Treffer, mittel = knapp, schwer = daneben
  const lv = (level: 'leicht' | 'mittel' | 'schwer') => { const s = new ScoreSession(melody, 0, level); for (let i = 0; i < ref.length; i++) s.add(i / fps, ref[i] ? ref[i] + 0.7 : 0); return s.result() }
  const [l, m, h] = [lv('leicht'), lv('mittel'), lv('schwer')]
  console.log('0,7 Halbtöne daneben → leicht', l.parts.pitch, '/ mittel', m.parts.pitch, '/ schwer', h.parts.pitch, '| getroffen %:', l.accuracy, m.accuracy, h.accuracy)
  assert.ok(l.parts.pitch === 100 && m.parts.pitch > 55 && m.parts.pitch < 80 && h.parts.pitch < 40)
  assert.ok(l.accuracy === 100 && m.accuracy === 100 && h.accuracy < 10)
}
assert.ok(wrongKey.total <= 30 && wrongKey.parts.pitch === 0)
assert.ok(drone.total < 40)
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

// ---------- Bewertung ohne Originalmelodie ----------
import { freeScore } from '../src/lib/freeScore.ts'
import { parseUltraStar, syllableProgress } from '../src/lib/ultrastar.ts'
{
  const lines = Array.from({ length: 8 }, (_, k) => ({ t: k * 4, text: 'Kurze Zeile hier' }))
  const N = fps * 32
  const mk = (fn: (i: number, inLine: boolean, k: number) => number) => {
    const u = new Float32Array(N)
    for (let i = 0; i < N; i++) { const k = Math.floor(i / (4 * fps)); u[i] = fn(i, i % (4 * fps) < 2.5 * fps, k) }
    return freeScore(u, fps, lines)
  }
  const scale = [60, 62, 64, 65, 67, 69, 71, 72]
  const good = mk((i, on) => (on ? scale[Math.floor(i / 20) % 8] + 0.15 * Math.sin(i / 2) : 0))
  const sharp = mk((i, on) => (on ? scale[Math.floor(i / 20) % 8] + 0.3 + 0.15 * Math.sin(i / 2) : 0)) // andere Stimmung, gleiche Tonart
  const droneF = mk((_, on) => (on ? 61.3 : 0))
  const speech = mk((i, on) => (on ? 55 + 6 * rnd() + 3 * Math.sin(i / 3) : 0))
  const chroma = mk((i, on) => (on ? 60 + (Math.floor(i / 12) * 7) % 12 + (Math.floor(i / 12) % 2) * 0.5 : 0))
  const offbeat = mk((i, on) => (!on ? scale[Math.floor(i / 20) % 8] : 0))
  const quiet = mk(() => 0)
  const sh = (nm: string, r: typeof good) => console.log(nm.padEnd(22), String(r.total).padStart(3), JSON.stringify(r.parts), 'Tonart', r.accuracy)
  sh('frei: sauber', good); sh('frei: andere Stimmung', sharp); sh('frei: Brummer', droneF); sh('frei: Sprechen', speech)
  sh('frei: schief', chroma); sh('frei: nur in Pausen', offbeat); sh('frei: stumm', quiet)
  assert.ok(good.total >= 90 && sharp.total >= 90)
  assert.ok(droneF.total < 60 && droneF.parts.pitch <= 30)
  assert.ok(speech.parts.pitch < 25)
  assert.ok(chroma.parts.pitch < good.parts.pitch - 30)
  assert.ok(offbeat.total < 50)
  assert.equal(quiet.total, 0)
}
{
  const us = parseUltraStar(`#TITLE:Test\n#ARTIST:Wer\n#BPM:150\n#GAP:2000\n: 0 4 0 Hal\n: 4 4 2 lo\n: 8 8 4  Welt\n- 20\n* 24 4 -3 Neu\nF 28 4 0 ~\nE\n`)
  assert.equal(us.lines.length, 2); assert.equal(us.lines[0].text, 'Hallo Welt'); assert.equal(us.notes, 4)
  assert.equal(us.melody[Math.round(2.05 * 50)], 60); assert.equal(us.melody[Math.round(2.5 * 50)], 62); assert.equal(us.melody[Math.round(4.5 * 50)], 57)
  assert.equal(us.melody[Math.round(1.5 * 50)], 0)
  assert.ok(Math.abs(us.lines[0].t - 2) < 1e-9 && Math.abs(us.lines[1].t - 4.4) < 1e-9)
  const p = syllableProgress(us.lines[0], 2.4)
  assert.ok(p > 0.25 && p < 0.35, 'Silbenfortschritt ' + p)
  console.log('UltraStar OK')
}
{
  const { estimateWords, syllables } = await import('../src/lib/words.ts')
  assert.equal(syllables('Götterfunken'), 4); assert.equal(syllables('and'), 1)
  // dichte Zeilen (3 s) und eine Zeile mit langer Pause (9 s) – die Füllung darf die Pause nicht mitnehmen
  const ls = [0, 3, 6, 15, 18].map((t) => ({ t, text: 'When we are grey and old' }))
  const w = estimateWords(ls)
  const end = (k: number) => w[k].syl[w[k].syl.length - 1].e - w[k].t
  console.log('Wortschätzung: Zeilendauer dicht', end(0).toFixed(2), '· vor Pause', end(2).toFixed(2))
  assert.ok(end(0) > 2.4 && end(0) <= 2.9); assert.ok(end(2) < 3.4, 'Pause wird nicht mitgefüllt')
  assert.equal(w[0].syl.length, 6)
  console.log('Wörter OK')
}
{
  // Ausrichtung der Notendatei: 12 s Vorspann und 1,5 % anderes Tempo müssen erkannt werden; Refrain wiederholt sich
  const { alignFit } = await import('../src/spotify/melodyDb.ts')
  const words = ['Erste Strophe beginnt', 'Zweite Zeile folgt', 'Refrain kommt jetzt', 'Dritte Zeile hier', 'Vierte Zeile dort', 'Refrain kommt jetzt', 'Fuenfte Zeile dann', 'Sechste Zeile noch', 'Refrain kommt jetzt', 'Letzte Zeile endet']
  const us: any = { lines: words.map((text, k) => ({ t: 12 + k * 20, text, syl: [] })) }
  const lrc = words.map((text, k) => ({ t: (12 + k * 20) * 0.985 - 12 + 0.1 * (k % 2 ? 1 : -1), text }))
  const f = alignFit(us, lrc)!
  console.log('Ausrichtung: Tempo', f.a.toFixed(4), 'Versatz', f.b.toFixed(2), 'Zeilen', f.inliers)
  assert.ok(Math.abs(f.a - 0.985) < 0.003 && Math.abs(f.b + 12) < 0.4)
  assert.equal(alignFit(us, words.map((text, k) => ({ t: k * 7 + (k * k) % 13, text: 'ganz anderer text ' + k }))), null)
  console.log('Ausrichtung OK')
}
{
  const { findSections } = await import('../src/lib/sections.ts')
  // 2 Strophen à 4 Zeilen, dazwischen und danach derselbe Refrain (2 Zeilen), Pausen von 6 s zwischen den Teilen
  const L: { t: number; e: number; text: string }[] = []
  let t = 10
  const add = (texts: string[]) => { for (const text of texts) { L.push({ t, e: t + 2.5, text }); t += 3 } t += 6 }
  add(['Erste Strophe eins', 'zwei', 'drei', 'vier']); add(['Das ist der Refrain', 'und noch einmal']); add(['Zweite Strophe eins', 'zwei', 'drei', 'vier']); add(['Das ist der Refrain', 'und noch einmal'])
  const sec = findSections(L)
  console.log('Abschnitte:', sec.map((x) => x.label).join(', '))
  assert.deepEqual(sec.map((x) => x.label), ['Strophe 1', 'Refrain', 'Strophe 2', 'Refrain'])
  assert.equal(sec[1].from, 4); assert.equal(sec[1].to, 5)
}
{
  // Textfassungen: Mehrheit gewinnt, die exakt passende Fassung zieht ihre Gruppe vor, Zeiten werden gemittelt
  const { consensus } = await import('../src/spotify/api.ts')
  const mk = (off: number, jit: number[]) => ({ lines: ['Erste Zeile hier', 'Zweite Zeile dort', 'Dritte Zeile dann', 'Vierte Zeile noch', 'Fuenfte Zeile zuletzt'].map((text, k) => ({ t: 10 + k * 5 + off + (jit[k] ?? 0), text })) })
  const major = [mk(0, [0.3, 0, 0, 0, 0]), mk(0, [0, 0, 0.2, 0, 0]), mk(0, [-0.3, 0, 0, 0, 0]), mk(0, [])]
  const minor = [mk(2, []), { ...mk(2, [0.1]), exact: true }]
  const a = consensus([...minor.map((m) => ({ lines: m.lines })), ...major])!
  assert.ok(Math.abs(a.lines[0].t - 10) < 0.05, 'Mehrheit + Median: ' + a.lines[0].t)
  const b = consensus([...minor, ...major])!
  assert.ok(Math.abs(b.lines[1].t - 17) < 0.05, 'exakte Fassung mit Bestätigung: ' + b.lines[1].t)
  console.log('Textfassungen OK')
}
{
  // Musik-Ausblendung: Musik + Originalsänger kommen mit ~0,03 an, die eigene Stimme nah am Mikrofon mit ~0,15
  const { BleedGate } = await import('../src/lib/bleed.ts')
  const g = new BleedGate(2.3)
  assert.ok(g.passes(0.01), 'vor der Messung wird nichts unterdrückt')
  for (let i = 0; i < 60; i++) g.feed(0.02 + 0.012 * rnd(), true)   // Intro: nur Musik
  for (let i = 0; i < 200; i++) g.feed(0.2, false)                    // Singen verändert die Messung nicht
  console.log('Musikpegel gemessen:', g.level.toFixed(3))
  assert.ok(g.level > 0.024 && g.level < 0.033)
  { const loud = new BleedGate(2.3, 0.035); for (let i = 0; i < 60; i++) loud.feed(0.2, true); assert.equal(loud.passes(0.15), true, 'wer im Intro schon singt, wird später nicht ausgesperrt') }
  assert.equal(g.passes(0.035), false, 'Originalsänger aus dem Lautsprecher zählt nicht')
  assert.equal(g.passes(0.06), false, 'auch etwas lautere Stellen der Musik nicht')
  assert.equal(g.passes(0.15), true, 'eigene Stimme zählt')
  console.log('Musik-Ausblendung OK')
}
{
  // Selbst erkannter Versatz: ein sauberer Sänger kommt 0,3 s zu spät an (z. B. Ton über Funk am Fernseher)
  const mel = new Float32Array(fps * 60)
  for (let i = fps * 4; i < mel.length; i++) if (i % 40 < 30) mel[i] = 60 + ((Math.floor(i / 40) * 5) % 9) // wechselnde Töne mit Pausen
  const late = new ScoreSession({ fps, data: mel, source: 'stems' })
  for (let i = 0; i < mel.length - 15; i++) late.add((i + 15) / fps, mel[i])
  const before = late.result()
  const lag = late.estimateLag()
  late.shift(lag)
  const after = late.result()
  console.log('Versatz erkannt:', lag, 'Frames (=', lag / fps, 's) | Punkte vorher', before.total, '→ nachher', after.total)
  assert.equal(lag, 15); assert.ok(before.total < 80 && after.total >= 95)
  // pünktlicher Sänger: nichts verschieben
  const onTime = new ScoreSession({ fps, data: mel, source: 'stems' })
  for (let i = 0; i < mel.length; i++) onTime.add(i / fps, mel[i])
  assert.equal(onTime.estimateLag(), 0)
  // schiefer Sänger: kein „Versatz" herbeirechnen
  const off = new ScoreSession({ fps, data: mel, source: 'stems' })
  for (let i = 0; i < mel.length; i++) off.add(i / fps, mel[i] ? 55 + 9 * rnd() : 0)
  assert.equal(off.estimateLag(), 0, 'schief bleibt schief')
  console.log('Versatz-Erkennung OK')
}
{
  // Abschnittsweise Verschiebung: ab 10 s alles 5 s später (längeres Zwischenspiel in der Spotify-Aufnahme)
  const { parseUltraStar } = await import('../src/lib/ultrastar.ts')
  const u = parseUltraStar('#ENCOREWARP:10.00:5.00\n#BPM:150\n#GAP:2000\n: 0 4 0 Eins\n- 10\n: 100 4 2 Zwei\nE\n')
  assert.ok(Math.abs(u.lines[0].t - 2) < 1e-9 && Math.abs(u.lines[1].t - 17) < 1e-9, 'Zeiten ' + u.lines.map((l) => l.t))
  assert.equal(u.melody[Math.round(17.1 * 50)], 62); assert.equal(u.melody[Math.round(12.1 * 50)], 0)
  console.log('Sprungstellen OK')
}
{
  const { fixEncoding, parseUltraStar } = await import('../src/lib/ultrastar.ts')
  assert.equal(fixEncoding('f¸r dich w‰r ich schˆn, D¸se, groﬂ'), 'für dich wär ich schön, Düse, groß')
  assert.equal(fixEncoding('Für Élise – schön'), 'Für Élise – schön', 'richtig gespeicherte Texte bleiben unverändert')
  assert.equal(fixEncoding('È una bella canzone'), 'È una bella canzone', 'ohne eindeutige Anzeichen nichts ändern')
  const u = parseUltraStar('#BPM:150\n#GAP:0\n: 0 4 0 f¸r \n: 5 4 2 dich\nE\n')
  assert.equal(u.lines[0].text, 'für dich')
  console.log('Umlaute OK')
}
