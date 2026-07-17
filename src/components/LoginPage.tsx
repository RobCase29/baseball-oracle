import { useState, type FormEvent } from 'react'
import { KeyRound, LoaderCircle } from 'lucide-react'
import './LoginPage.css'

function safeDestination(): string {
  const requested = new URLSearchParams(window.location.search).get('next')
  return requested?.startsWith('/') && !requested.startsWith('//') ? requested : '/'
}

export function LoginPage() {
  const [code, setCode] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!code.trim() || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      })
      if (!response.ok) {
        setError(response.status === 429
          ? 'Too many attempts. Please wait before trying again.'
          : 'That access code was not recognized.')
        return
      }
      window.location.replace(safeDestination())
    } catch {
      setError('Sign-in is temporarily unavailable.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-shell" aria-labelledby="login-title">
        <div className="login-brand">
          <div className="login-mark" aria-hidden="true">O</div>
          <div>
            <span>BASEBALL</span>
            <strong>ORACLE</strong>
          </div>
        </div>

        <div className="login-copy">
          <span className="eyebrow">PRIVATE RESEARCH WORKSPACE</span>
          <h1 id="login-title">Sign in to Oracle</h1>
          <p>Use your private access code to open player rankings and market intelligence.</p>
        </div>

        <form className="login-form" onSubmit={submit}>
          <label htmlFor="oracle-access-code">Access code</label>
          <div className="login-input">
            <KeyRound size={17} aria-hidden="true" />
            <input
              id="oracle-access-code"
              type="password"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="current-password"
              autoFocus
              disabled={submitting}
            />
          </div>
          {error ? <p className="login-error" role="alert">{error}</p> : null}
          <button type="submit" disabled={!code.trim() || submitting}>
            {submitting ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : null}
            {submitting ? 'Signing in' : 'Enter Oracle'}
          </button>
        </form>

        <p className="login-security">Signed sessions use a secure, HttpOnly cookie and expire automatically.</p>
      </section>
    </main>
  )
}
