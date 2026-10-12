import { Headshot } from '@/app/_ui/Headshot';
import NameLabel from '@/app/_ui/NameLabel';
import DeptTag from '@/app/_ui/DeptTag';

// One person in an office or team list: photo, name (with the "unverified" chip until an admin verifies the
// account), department tag, approved position and, optionally, team. No hooks: server or client.
export default function PersonRow({ person, showTeam = true, extra = null }) {
  return (
    <li className="ofc-person">
      <Headshot user={person} size={34} />
      <span className="ofc-person-main">
        <NameLabel user={person} link />
        <span className="ofc-person-meta">
          <DeptTag dept={person.department} />
          {person.position && <span>{person.position}</span>}
          {showTeam && person.team && <span>· {person.team.name}</span>}
          {extra}
        </span>
      </span>
    </li>
  );
}
