import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import PhoneMic from './views/PhoneMic'

// Neue Versionen selbstständig holen: beim Start, alle 10 Minuten und wenn der Tab wieder in den Vordergrund kommt.
// Sonst bleibt ein lange offener Tab (Laptop, Fernseher) tagelang auf einem alten Stand.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    const check = () => { void reg.update().catch(() => {}) }
    setInterval(check, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check() })
  },
})
// Aufruf mit ?mic=CODE: dieses Gerät ist ein Handy-Mikrofon, nicht die Karaoke-App
const micCode = new URLSearchParams(location.search).get('mic')
createRoot(document.getElementById('root')!).render(micCode ? <PhoneMic code={micCode} /> : <App />)
