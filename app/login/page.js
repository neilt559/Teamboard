'use client';
import { useState } from 'react';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const path = mode === 'signup' ? '/api/auth/signup' : '/api/auth/login';
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, code }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Something went wrong.'); setBusy(false); return; }
      window.location.href = '/';
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span className="dot" /> TeamBoard</div>
        <h1 className="login-h">{mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
        <p className="login-sub">{mode === 'signup' ? 'Pick a username and password — you’ll stay signed in on this device.' : 'Welcome back.'}</p>
        {err && <div className="login-err">{err}</div>}

        <label className="login-label">Username</label>
        <input className="login-input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" spellCheck={false} />

        <label className="login-label">Password</label>
        <input type="password" className="login-input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />

        {mode === 'signup' && (
          <>
            <label className="login-label">Team code <span className="login-opt">(only if your team set one)</span></label>
            <input className="login-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </>
        )}

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : (mode === 'signup' ? 'Create account' : 'Sign in')}
        </button>
        <button type="button" className="login-toggle" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setErr(''); }}>
          {mode === 'signup' ? 'Already have an account? Sign in' : 'Need an account? Create one'}
        </button>
      </form>
    </div>
  );
}
