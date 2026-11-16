import { Yin, decimate, hzToMidi } from '../lib/pitch.ts'
import { BleedGate } from '../lib/bleed.ts'

export type MicMode = 'headphones' | 'speaker'
export interface MicSample { midi: number; level: number; voiced: boolean; /** unverarbeiteter Pegel, für die Musik-Ausblendung */ rms?: number }

/**
 * Eingebautes Mikrofon → Echtzeit-Tonhöhe. Das Signal wird ausschließlich lokal analysiert,
 * nie aufgezeichnet, nie übertragen und nicht auf die Lautsprecher gegeben (keine Rückkopplung).
 */
export class Mic {
  private stream: MediaStream | null = null
  private src: MediaStreamAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private raw = new Float32Array(2048)
  private dec = new Float32Array(1024)
  private yin: Yin | null = null
  private factor = 4
  private floor = 0.002
  private last = 0
  private stable = 0
  /** Pegel in Phasen, in denen niemand singen soll (Intro, Pausen) – das ist die Musik, die das Mikrofon mithört */
  // Obergrenze 0,06: Eine Stimme nah am Mikrofon liegt darüber. Ist die Musik selbst so laut (Handy-Lautsprecher
  // direkt neben dem Mikrofon), hilft nur die Echo-Unterdrückung – die Wiedergabe-Ansicht schaltet dann darauf um.
  private gate = new BleedGate(2, 0.06)
  /** Pegel der mitgehörten Musik (0 = nichts). Ab ~0,02 verfälscht sie die Wertung spürbar. */
  get bleed() { return this.gate.level }
  mode: MicMode = 'headphones'
  active = false

  async start(ctx: AudioContext, mode: MicMode) {
    this.stop()
    this.mode = mode
    const speaker = mode === 'speaker'
    // Lautsprecher-Modus: Echo-Unterdrückung des Browsers filtert die eigene Musik aus dem Mikrofonsignal.
    // Kopfhörer-Modus: unbearbeitetes Signal – beste Tonhöhenerkennung.
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: speaker, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      video: false,
    })
    this.src = ctx.createMediaStreamSource(this.stream)
    const hp = ctx.createBiquadFilter()
    hp.type = 'highpass'; hp.frequency.value = speaker ? 100 : 80; hp.Q.value = 0.7
    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'; lp.frequency.value = 3500
    this.analyser = ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0
    this.src.connect(hp).connect(lp).connect(this.analyser)
    this.factor = Math.max(1, Math.round(ctx.sampleRate / 12000))
    const size = Math.floor(2048 / this.factor)
    this.yin = new Yin(ctx.sampleRate / this.factor, size, 75, 1000)
    this.floor = 0.002
    this.gate.reset()
    this.active = true
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop())
    this.src?.disconnect()
    this.stream = null; this.src = null; this.analyser = null
    this.active = false
  }

  /**
   * @param expectSilence true, wenn laut Song gerade niemand singen soll. In diesen Phasen wird gemessen, wie laut
   *   die Musik im Mikrofon ankommt; nur was deutlich lauter ist, zählt danach als eigene Stimme. So bekommt der
   *   Originalsänger aus dem Lautsprecher keine Punkte.
   */
  sample(expectSilence = false): MicSample {
    if (!this.analyser || !this.yin) return { midi: 0, level: 0, voiced: false }
    this.analyser.getFloatTimeDomainData(this.raw)
    decimate(this.raw, this.factor, this.dec)
    const speaker = this.mode === 'speaker'
    const r = this.yin.detect(this.dec, 0, speaker ? 0.15 : 0.18)
    // adaptiver Grundpegel: folgt leisen Phasen schnell, lauten nur sehr träge
    this.floor += (r.rms > this.floor ? 0.003 : 0.25) * (r.rms - this.floor)
    this.gate.feed(r.rms, expectSilence)
    // die eigene Stimme muss klar über der mitgehörten Musik liegen (Faktor 2 ≈ 6 dB)
    const gate = Math.max(speaker ? 0.012 : 0.006, this.floor * (speaker ? 2.2 : 1.6), this.gate.level * this.gate.factor)
    // Singstimmen liegen zwischen ~80 und 880 Hz; alles andere sind Störgeräusche oder Obertöne
    let midi = r.hz >= 80 && r.hz <= 880 && r.rms > gate ? hzToMidi(r.hz) : 0
    // Einzelne Ausreißer-Frames unterdrücken: Ton muss zwei Frames in Folge halten
    if (midi && this.last && Math.abs(midi - this.last) < 1.5) this.stable++
    else this.stable = 0
    this.last = midi
    const voiced = midi > 0 && this.stable >= 1
    if (!voiced) midi = 0
    return { midi, level: Math.min(1, r.rms * 6), voiced, rms: r.rms }
  }
}

export const mic = new Mic()
