// Kleines Protokoll der letzten Ereignisse (nur auf diesem Gerät gespeichert). Wenn etwas nicht startet,
// lässt sich hier nachlesen, an welcher Stelle es hing – unter „Hilfe & Musikquellen" → Diagnose.
const KEY = 'encore-diag'
let mem: string[] | null = null

const load = (): string[] => {
  if (mem) return mem
  try { mem = JSON.parse(localStorage.getItem(KEY) || '[]') as string[] } catch { mem = [] }
  return mem!
}

export function diag(msg: string) {
  const list = load()
  const t = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  list.push(`${t}  ${msg}`)
  if (list.length > 80) list.splice(0, list.length - 80)
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* Speicher voll – egal */ }
}

export const diagText = () => load().join('\n')
export const diagClear = () => { mem = []; localStorage.removeItem(KEY) }
