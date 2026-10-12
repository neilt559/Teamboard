import { IconList } from '@/app/icons';
import './lists.css';

// Skeleton while All tasks loads (design §2.1).
export default function AllTasksLoading() {
  return (
    <div className="lt-loading" aria-busy="true" aria-live="polite">
      <div className="proj-head">
        <h1 className="wi-h"><IconList size={24} /> All Tasks</h1>
        <span className="progress-label">Loading tasks…</span>
      </div>
      <div className="lt-skel lt-skel-filters" />
      <div className="lt-skel lt-skel-table" />
    </div>
  );
}
