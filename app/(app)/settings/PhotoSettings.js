'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { IconCamera, IconUsers } from '@/app/icons';
import { PhotoEditor } from '@/app/welcome/fields';
import VoterPhotos from '@/app/_ui/VoterPhotos';

// Settings > Photo (inventory §1.16): your headshot (upload, drag and zoom it into the circle, adjust later,
// remove), plus the Voter photos list for setting other people's photos, which anyone can still do
// (Neil's deliberate choice, rule 50; each change is recorded).
export default function PhotoSettings({ viewer, data }) {
  const router = useRouter();
  const [photo, setPhoto] = useState({ avatar_v: data.me.avatar_v, avatar_crop: data.me.avatar_crop, has_src: data.me.has_src });
  const [others, setOthers] = useState(false);
  const changed = (p) => { setPhoto({ avatar_v: p.avatar_v, avatar_crop: p.avatar_crop, has_src: p.has_src }); router.refresh(); };
  return (
    <div className="pf-form">
      <div className="pf-section">
        <h2 className="pf-h wi"><IconCamera size={17} /> Your photo</h2>
        <p className="pf-help">Shows next to your name, your votes and your posts. After picking a photo you can drag and zoom it to fit the circle.</p>
        <PhotoEditor me={viewer} photo={photo} onChange={changed} size={112} />
      </div>
      <div className="pf-section">
        <h2 className="pf-h wi"><IconUsers size={17} /> Other people’s photos</h2>
        <p className="pf-help">Anyone can set anyone’s photo, so one person can load the whole office.</p>
        <button type="button" className="btn btn-plain wi" onClick={() => setOthers(true)}><IconCamera size={15} /> Voter photos</button>
      </div>
      {others && (
        <VoterPhotos
          me={viewer}
          onClose={() => { setOthers(false); router.refresh(); }}
          onChanged={(id, p) => { if (String(id) === String(viewer.id)) setPhoto(p); }}
        />
      )}
    </div>
  );
}
