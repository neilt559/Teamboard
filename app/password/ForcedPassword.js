'use client';
import { ChangePasswordForm } from '@/app/_ui/ChangePassword';
import { logout } from '@/app/_ui/api';
import { IconKey } from '@/app/icons';

// The forced password change as a page (was the undismissable ChangePasswordModal in forced mode).
// After "Done" the person carries on: to the profile wizard when that is still to do, otherwise Home.
export default function ForcedPassword({ viewer }) {
  const go = () => { window.location.href = viewer?.profile_done ? '/' : '/welcome'; };
  return (
    <div className="login-wrap">
      <div className="login-card pw-card">
        <div className="login-brand"><span className="dot" /> TeamBoard</div>
        <h1 className="login-h wi-h"><IconKey size={22} /> Choose a new password</h1>
        <ChangePasswordForm user={viewer} forced onDone={go} doneLabel="Continue" />
        <button type="button" className="login-toggle" onClick={() => logout()}>Not you? Log out</button>
      </div>
    </div>
  );
}
