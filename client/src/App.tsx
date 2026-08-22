import { useEffect, useState } from 'react'
import { socket } from './lib/socket'
import './App.css'

type Status = 'checking' | 'up' | 'down'

function App() {
  const [apiStatus, setApiStatus] = useState<Status>('checking')
  const [socketStatus, setSocketStatus] = useState<Status>('checking')

  useEffect(() => {
    fetch('/api/health')
      .then((res) => setApiStatus(res.ok ? 'up' : 'down'))
      .catch(() => setApiStatus('down'))

    const onConnect = () => setSocketStatus('up')
    const onDisconnect = () => setSocketStatus('down')
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('connect_error', onDisconnect)
    socket.connect()

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('connect_error', onDisconnect)
      socket.disconnect()
    }
  }, [])

  return (
    <main className="shell">
      <h1>Bingus</h1>
      <p className="tagline">Bingo with friends. And trash talk.</p>
      <dl className="status">
        <dt>API</dt>
        <dd data-status={apiStatus}>{apiStatus}</dd>
        <dt>Socket</dt>
        <dd data-status={socketStatus}>{socketStatus}</dd>
      </dl>
    </main>
  )
}

export default App
