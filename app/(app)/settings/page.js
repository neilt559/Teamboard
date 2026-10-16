import Link from 'next/link';
import { requirePageViewer, publicViewer } from '@/lib/viewer';
import { loadSettings } from '@/lib/queries/profile';
import { IconSettings, IconUser, IconFilter, IconCamera, IconKey, IconTag } from '@/app/icons';
import ProfileForm from './ProfileForm';
import FullNameSetting from './FullNameSetting';
import CustomizeForm from './CustomizeForm';
import PhotoSettings from './PhotoSettings';
import SecuritySettings from './SecuritySettings';
import NameOnTasks from './NameOnTasks';
import SettingsRefresh from './SettingsRefresh';

// /settings (design §2.1, §5.3, §11): your own account. Tabs are plain links (?tab=...), so each one is a
// fresh page load: Profile (office change and position elevation become requests), Customize (Home, landing
// page, follows, pins, density), Photo, Password (plus "Sign out other devices"), Name on tasks (link me to an
// existing name, or my own name's spelling and color). Self only; admins edit others on /admin/users.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

export const metadata = { title: 'Settings' };

const TABS = [
  { key: 'profile', label: 'Profile', Icon: IconUser },
  { key: 'customize', label: 'Customize', Icon: IconFilter },
  { key: 'photo', label: 'Photo', Icon: IconCamera },
  { key: 'password', label: 'Password', Icon: IconKey },
  { key: 'names', label: 'Name on tasks', Icon: IconTag },
];

export default async function SettingsPage({ searchParams }) {
  const viewer = await requirePageViewer();
  const tab = TABS.some((t) => t.key === searchParams?.tab) ? searchParams.tab : 'profile';
  const data = await loadSettings(viewer);
  const v = publicViewer(viewer);
  return (
    <div className="settings-page">
      <SettingsRefresh />
      <div className="proj-head">
        <h1 className="wi-h"><IconSettings size={24} /> Settings</h1>
      </div>
      <nav className="set-tabs" aria-label="Settings sections">
        {TABS.map(({ key, label, Icon }) => (
          <Link
            key={key}
            href={key === 'profile' ? '/settings' : `/settings?tab=${key}`}
            prefetch={false}
            replace
            scroll={false}
            className={`set-tab${tab === key ? ' on' : ''}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            <Icon size={15} /> {label}
          </Link>
        ))}
      </nav>
      <section className="set-panel">
        {tab === 'profile' && <><ProfileForm viewer={v} data={data} /><FullNameSetting me={data.me} /></>}
        {tab === 'customize' && <CustomizeForm viewer={v} data={data} />}
        {tab === 'photo' && <PhotoSettings viewer={v} data={data} />}
        {tab === 'password' && <SecuritySettings viewer={v} devices={data.devices} />}
        {tab === 'names' && <NameOnTasks viewer={v} data={data} />}
      </section>
    </div>
  );
}
