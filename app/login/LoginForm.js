'use client';
import { useState } from 'react';

// The sign-in card (moved from the old app/login/page.js; inventory §1.1). Same look, wording and behavior,
// plus what signup now needs (design §5.1): full name and a work email, and a ?next= return path.
// Posts straight to the auth routes (not api(), which would treat a wrong password's 401 as "signed out").
const EMAIL_DOMAIN = 'cagecivil.com';

export default function LoginForm({ next = '', initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode === 'signup' ? 'signup' : 'login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [userTouched, setUserTouched] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const signup = mode === 'signup';

  // Suggest a username from the work email until the person types their own.
  const onEmail = (v) => {
    setEmail(v);
    if (!userTouched) {
      const local = v.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
      setUsername(local);
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const path = signup ? '/api/auth/signup' : '/api/auth/login';
      const body = signup
        ? { display_name: name, email, username, password, code }
        : { username, password, next };
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-TB-Client': '2' },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error || 'Something went wrong.'); setBusy(false); return; }
      // This tab has "landed": Home won't bounce to the landing preference again (design §11).
      try { sessionStorage.setItem('tb_landed', '1'); } catch {}
      window.location.href = typeof j.next === 'string' && j.next.startsWith('/') && !j.next.startsWith('//') ? j.next : '/';
    } catch {
      setErr('Network error — please try again.');
      setBusy(false);
    }
  };

  const toggle = () => { setMode(signup ? 'login' : 'signup'); setErr(''); };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} noValidate>
        <div className="login-brand"><span className="dot" /> TeamBoard</div>
        <h1 className="login-h">{signup ? 'Create your account' : 'Sign in'}</h1>
        <p className="login-sub">{signup ? 'Pick a username and password — you’ll stay signed in on this device.' : 'Welcome back.'}</p>
        {err && <div className="login-err" role="alert">{err}</div>}

        {signup && (
          <>
            <label className="login-label" htmlFor="lg-name">Full name</label>
            <input id="lg-name" className="login-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              autoComplete="name" maxLength={80} placeholder="First Last" />

            <label className="login-label" htmlFor="lg-email">Work email</label>
            <input id="lg-email" className="login-input" type="email" inputMode="email" value={email}
              onChange={(e) => onEmail(e.target.value)} autoComplete="email" spellCheck={false} autoCapitalize="none"
              maxLength={254} placeholder={`you@${EMAIL_DOMAIN}`} />
          </>
        )}

        <label className="login-label" htmlFor="lg-user">Username</label>
        <input id="lg-user" className="login-input" value={username}
          onChange={(e) => { setUsername(e.target.value); setUserTouched(true); }}
          autoFocus={!signup} autoComplete="username" spellCheck={false} autoCapitalize="none" maxLength={signup ? 40 : 200} />
        {signup && <span className="login-hint">3-40 characters: lowercase letters, numbers, and . _ - @</span>}

        <label className="login-label" htmlFor="lg-pass">Password</label>
        <input id="lg-pass" type="password" className="login-input" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={signup ? 'new-password' : 'current-password'} maxLength={200} />
        {signup && <span className="login-hint">At least 6 characters.</span>}

        {signup && (
          <>
            <label className="login-label" htmlFor="lg-code">Team code <span className="login-opt">(ask your team)</span></label>
            <input id="lg-code" className="login-input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off"
              spellCheck={false} autoCapitalize="none" maxLength={100} />
          </>
        )}

        <button className="login-btn" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : (signup ? 'Create account' : 'Sign in')}
        </button>
        <button type="button" className="login-toggle" onClick={toggle}>
          {signup ? 'Already have an account? Sign in' : 'Need an account? Create one'}
        </button>
        {!signup && <p className="login-foot">Forgot your password? Ask an admin to reset it.</p>}
      </form>
    </div>
  );
}
