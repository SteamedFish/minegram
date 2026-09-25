import './App.css'

type AppProps = {
  phaseLabel: string
}

function App({ phaseLabel }: AppProps) {
  return (
    <main className="app-shell">
      <p className="app-shell__eyebrow">{phaseLabel}</p>
      <h1>Minegram</h1>
      <p>Project foundation is ready.</p>
      <p>Gameplay and visual design will arrive in later phases.</p>
    </main>
  )
}

export default App
