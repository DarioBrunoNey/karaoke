import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './index.css'
import App from './App'
import PhoneMic from './views/PhoneMic'

registerSW({ immediate: true })
// Aufruf mit ?mic=CODE: dieses Gerät ist ein Handy-Mikrofon, nicht die Karaoke-App
const micCode = new URLSearchParams(location.search).get('mic')
createRoot(document.getElementById('root')!).render(micCode ? <PhoneMic code={micCode} /> : <App />)
