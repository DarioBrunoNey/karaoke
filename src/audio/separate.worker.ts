/// <reference lib="webworker" />
// Gesangstrennung im Browser: Mitten-Extraktion im Frequenzbereich (STFT).
// Prinzip: Leadgesang ist fast immer exakt mittig gemischt (links = rechts). Je Frequenzband wird
// gemessen, wie ähnlich sich linker und rechter Kanal sind; identische Anteile wandern in die
// „Gesangsspur", der Rest bleibt als Stereo-Instrumental. Bass unter ~120 Hz bleibt im Instrumental.
import { extractMelody } from './melody.ts'

function makeFft(n: number) {
  const rev = new Uint32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const cos = new Float32Array(n / 2), sin = new Float32Array(n / 2)
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n)
    sin[i] = Math.sin((2 * Math.PI * i) / n)
  }
  return (re: Float32Array, im: Float32Array, inverse: boolean) => {
    for (let i = 0; i < n; i++) {
      const j = rev[i]
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t
        t = im[i]; im[i] = im[j]; im[j] = t
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size
      for (let s = 0; s < n; s += size) {
        for (let k = 0; k < half; k++) {
          const c = cos[k * step], si = inverse ? sin[k * step] : -sin[k * step]
          const a = s + k, b = a + half
          const tr = re[b] * c - im[b] * si, ti = re[b] * si + im[b] * c
          re[b] = re[a] - tr; im[b] = im[a] - ti
          re[a] += tr; im[a] += ti
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n }
  }
}

function centerExtract(l: Float32Array, r: Float32Array, sr: number, progress: (p: number) => void): Float32Array {
  const N = 4096, hop = N / 4, len = l.length
  const fft = makeFft(N)
  const w = new Float32Array(N)
  for (let i = 0; i < N; i++) w[i] = Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N))
  const band = new Float32Array(N / 2 + 1)
  for (let k = 0; k <= N / 2; k++) {
    const f = (k * sr) / N
    band[k] = f < 110 ? 0 : f < 200 ? (f - 110) / 90 : f < 11000 ? 1 : f < 14000 ? (14000 - f) / 3000 : 0
  }
  const c = new Float32Array(len)
  const lr = new Float32Array(N), li = new Float32Array(N), rr = new Float32Array(N), ri = new Float32Array(N)
  let frame = 0
  for (let s = -(N - hop); s < len; s += hop, frame++) {
    for (let i = 0; i < N; i++) {
      const p = s + i
      const inside = p >= 0 && p < len
      lr[i] = inside ? l[p] * w[i] : 0
      rr[i] = inside ? r[p] * w[i] : 0
      li[i] = 0; ri[i] = 0
    }
    fft(lr, li, false); fft(rr, ri, false)
    for (let k = 0; k <= N / 2; k++) {
      const pw = lr[k] * lr[k] + li[k] * li[k] + rr[k] * rr[k] + ri[k] * ri[k] + 1e-12
      const sim = (2 * (lr[k] * rr[k] + li[k] * ri[k])) / pw
      let m = 0
      if (sim > 0) { const s2 = sim * sim; m = s2 * s2 * band[k] }
      lr[k] = (m * (lr[k] + rr[k])) / 2
      li[k] = (m * (li[k] + ri[k])) / 2
      if (k > 0 && k < N / 2) { lr[N - k] = lr[k]; li[N - k] = -li[k] }
    }
    fft(lr, li, true)
    for (let i = 0; i < N; i++) {
      const p = s + i
      if (p >= 0 && p < len) c[p] += (lr[i] * w[i]) / 2
    }
    if (frame % 200 === 0) progress(s / len)
  }
  return c
}

export interface SeparateRequest {
  l: Float32Array
  r: Float32Array | null
  /** vorhandene Gesangsspur (Stems) – dann wird nur die Melodie berechnet */
  vocals?: Float32Array
  sampleRate: number
  needMelody: boolean
}

self.onmessage = (e: MessageEvent<SeparateRequest>) => {
  const { l, r, vocals, sampleRate, needMelody } = e.data
  const post = (stage: string, p: number) => self.postMessage({ type: 'progress', stage, p })
  let voc: Float32Array
  let mode: 'stems' | 'center' | 'mix'
  if (vocals) {
    voc = vocals; mode = 'stems'
  } else {
    let diff = 0, sum = 0
    if (r) for (let i = 0; i < l.length; i += 7) { diff += Math.abs(l[i] - r[i]); sum += Math.abs(l[i]) + Math.abs(r[i]) }
    if (!r || diff < sum * 0.01) {
      // Mono-Aufnahme: keine Trennung möglich
      voc = new Float32Array(l); mode = 'mix'
    } else {
      voc = centerExtract(l, r, sampleRate, (p) => post('Gesang wird herausgerechnet', p))
      for (let i = 0; i < l.length; i++) { l[i] -= voc[i]; r[i] -= voc[i] }
      mode = 'center'
    }
  }
  const melody = needMelody ? extractMelody(voc, sampleRate, (p) => post('Melodie wird analysiert', p)) : null
  if (mode === 'mix') voc = new Float32Array(1)
  const rOut = r ?? new Float32Array(l)
  const transfer: Transferable[] = [l.buffer, rOut.buffer, voc.buffer]
  if (melody) transfer.push(melody.buffer)
  self.postMessage({ type: 'done', l, r: rOut, voc, melody, mode }, transfer)
}
