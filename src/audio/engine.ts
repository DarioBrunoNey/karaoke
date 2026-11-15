import workletUrl from './player.worklet.ts?worker&url'
import type { Melody, Song } from '../lib/types'
import { MELODY_FPS } from './melody.ts'

export interface LoadResult { melody: Melody; mode: 'stems' | 'center' | 'mix' }

class Engine {
  ctx: AudioContext | null = null
  private node: AudioWorkletNode | null = null
  private master: GainNode | null = null
  private pos = 0
  private posAt = 0
  playing = false
  duration = 0
  tempo = 1
  onEnded: (() => void) | null = null

  async init() {
    if (this.ctx) {
      if (this.ctx.state !== 'running') await this.ctx.resume()
      return
    }
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    await ctx.audioWorklet.addModule(workletUrl)
    const node = new AudioWorkletNode(ctx, 'karaoke-player', { numberOfInputs: 0, outputChannelCount: [2] })
    const master = ctx.createGain()
    node.connect(master).connect(ctx.destination)
    node.port.onmessage = (e) => {
      const m = e.data
      if (m.type === 'pos') { this.pos = m.pos; this.posAt = performance.now() }
      if (m.type === 'ended') { this.playing = false; this.pos = this.duration; this.onEnded?.() }
    }
    this.ctx = ctx; this.node = node; this.master = master
    if (ctx.state !== 'running') await ctx.resume()
  }

  /** Dekodiert den Song, trennt Gesang/Instrumental und lädt beides in den Audio-Thread. */
  async load(song: Song, onProgress: (stage: string, p: number) => void): Promise<LoadResult> {
    await this.init()
    const ctx = this.ctx!
    this.pause()
    onProgress('Audio wird geladen', 0)
    const dec = async (b: Blob) => ctx.decodeAudioData(await b.arrayBuffer())
    let l: Float32Array, r: Float32Array | null, vocals: Float32Array | undefined
    if (song.stems) {
      const [inst, voc] = await Promise.all([dec(song.stems.instrumental), dec(song.stems.vocals)])
      l = inst.getChannelData(0).slice()
      r = inst.numberOfChannels > 1 ? inst.getChannelData(1).slice() : null
      const v = new Float32Array(l.length)
      const n = Math.min(l.length, voc.length)
      for (let c = 0; c < voc.numberOfChannels; c++) {
        const d = voc.getChannelData(c)
        for (let i = 0; i < n; i++) v[i] += d[i] / voc.numberOfChannels
      }
      vocals = v
    } else {
      const buf = await dec(song.audio)
      l = buf.getChannelData(0).slice()
      r = buf.numberOfChannels > 1 ? buf.getChannelData(1).slice() : null
    }
    this.duration = l.length / ctx.sampleRate
    const cached = song.melody && song.melody.source === (song.stems ? 'stems' : song.melody.source) ? song.melody : undefined

    const worker = new Worker(new URL('./separate.worker.ts', import.meta.url), { type: 'module' })
    const res = await new Promise<any>((resolve, reject) => {
      worker.onmessage = (e) => {
        if (e.data.type === 'progress') onProgress(e.data.stage, e.data.p)
        else resolve(e.data)
      }
      worker.onerror = (e) => reject(new Error(e.message))
      const transfer: Transferable[] = [l.buffer]
      if (r) transfer.push(r.buffer)
      if (vocals) transfer.push(vocals.buffer)
      worker.postMessage({ l, r, vocals, sampleRate: ctx.sampleRate, needMelody: !cached }, transfer)
    })
    worker.terminate()
    this.node!.port.postMessage({ type: 'load', l: res.l, r: res.r, v: res.voc }, [res.l.buffer, res.r.buffer, res.voc.buffer])
    this.pos = 0; this.posAt = performance.now()
    const melody: Melody = cached ?? { fps: MELODY_FPS, data: res.melody, source: res.mode }
    return { melody, mode: res.mode }
  }

  unload() {
    this.pause()
    this.node?.port.postMessage({ type: 'unload' })
  }

  async play() {
    await this.init()
    this.posAt = performance.now()
    this.playing = true
    this.node!.port.postMessage({ type: 'play' })
  }
  pause() {
    if (!this.node) return
    this.pos = this.rawTime
    this.playing = false
    this.node.port.postMessage({ type: 'pause' })
  }
  seek(t: number) {
    t = Math.max(0, Math.min(this.duration - 0.05, t))
    this.pos = t; this.posAt = performance.now()
    this.node?.port.postMessage({ type: 'seek', pos: t })
  }
  setParams(p: { vocalGain?: number; instGain?: number; tempo?: number; pitch?: number }) {
    if (p.tempo !== undefined) { this.pos = this.rawTime; this.posAt = performance.now(); this.tempo = p.tempo }
    this.node?.port.postMessage({ type: 'params', ...p })
  }
  setVolume(v: number) {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02)
  }

  private get rawTime() {
    return this.playing ? this.pos + ((performance.now() - this.posAt) / 1000) * this.tempo : this.pos
  }
  /** Position im Song (Sekunden), die gerade aus dem Lautsprecher kommt */
  get time() {
    const lat = this.ctx ? (this.ctx.outputLatency || this.ctx.baseLatency || 0) : 0
    return Math.max(0, Math.min(this.duration, this.rawTime - (this.playing ? lat * this.tempo : 0)))
  }
}

export const engine = new Engine()

// Diagnose-/Testzugriff (z. B. für tests/e2e.mjs)
;(globalThis as any).__encore = { engine }
