// Wiedergabe im Audio-Thread: mischt Instrumental + Gesangsspur und schickt die Summe durch
// SoundTouch (Tempo und Tonhöhe unabhängig voneinander, LGPL-Bibliothek soundtouchjs).
import { SoundTouch, SimpleFilter } from 'soundtouchjs'

class KaraokePlayer extends AudioWorkletProcessor {
  l: Float32Array | null = null
  r: Float32Array | null = null
  v: Float32Array | null = null
  len = 0
  playing = false
  vocalGain = 0
  instGain = 1
  tempo = 1
  pitch = 0
  st!: SoundTouch
  filter!: SimpleFilter
  buf = new Float32Array(256)
  anchor = 0 // hörbare Quellposition (Frames) beim letzten Anker
  outSince = 0
  tick = 0

  constructor() {
    super()
    this.rebuild(0)
    this.port.onmessage = (e) => this.onMsg(e.data)
  }

  get pos() { return this.anchor + this.outSince * this.tempo }

  rebuild(pos: number) {
    this.st = new SoundTouch()
    this.st.tempo = this.tempo
    this.st.pitchSemitones = this.pitch
    this.filter = new SimpleFilter(
      {
        extract: (target, n, position) => {
          const { l, r, v, len } = this
          const ig = this.instGain, vg = this.vocalGain
          const hasV = !!v && v.length === len
          for (let i = 0; i < n; i++) {
            const p = position + i
            if (l && r && p < len) {
              const voc = hasV ? v![p] * vg : 0
              target[2 * i] = l[p] * ig + voc
              target[2 * i + 1] = r[p] * ig + voc
            } else {
              target[2 * i] = 0; target[2 * i + 1] = 0
            }
          }
          return n // hinter dem Ende Stille liefern, damit der Rest sauber ausläuft
        },
      },
      this.st,
    )
    this.filter.sourcePosition = Math.max(0, Math.round(pos))
    this.anchor = Math.max(0, pos)
    this.outSince = 0
  }

  onMsg(m: any) {
    switch (m.type) {
      case 'load':
        this.l = m.l; this.r = m.r; this.v = m.v; this.len = m.l.length
        this.playing = false
        this.rebuild(0)
        break
      case 'unload':
        this.l = this.r = this.v = null; this.len = 0; this.playing = false
        break
      case 'play': this.playing = true; break
      case 'pause': this.playing = false; break
      case 'seek': this.rebuild(m.pos * sampleRate); this.report(); break
      case 'params': {
        if (m.vocalGain !== undefined) this.vocalGain = m.vocalGain
        if (m.instGain !== undefined) this.instGain = m.instGain
        const tempoChanged = m.tempo !== undefined && m.tempo !== this.tempo
        const pitchChanged = m.pitch !== undefined && m.pitch !== this.pitch
        if (tempoChanged || pitchChanged) {
          const p = this.pos
          if (tempoChanged) this.tempo = m.tempo
          if (pitchChanged) this.pitch = m.pitch
          this.rebuild(p)
        }
        break
      }
    }
  }

  report() { this.port.postMessage({ type: 'pos', pos: this.pos / sampleRate, playing: this.playing }) }

  process(_in: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    if (!this.playing || !this.l) return true
    const n = out[0].length
    if (this.buf.length < n * 2) this.buf = new Float32Array(n * 2)
    const got = this.filter.extract(this.buf, n)
    const L = out[0], R = out[1] ?? out[0]
    for (let i = 0; i < got; i++) { L[i] = this.buf[2 * i]; R[i] = this.buf[2 * i + 1] }
    this.outSince += got
    if (this.pos >= this.len) {
      this.playing = false
      this.port.postMessage({ type: 'ended' })
    } else if (++this.tick % 6 === 0) this.report()
    return true
  }
}

registerProcessor('karaoke-player', KaraokePlayer)
