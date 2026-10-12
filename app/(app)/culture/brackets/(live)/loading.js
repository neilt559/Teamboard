// In the (live) route group so this skeleton covers /culture/brackets only: a Suspense boundary above
// /culture/brackets/[id] would send 200 before notFound() / redirect() could set 404 / 307.
// Skeleton while /culture/brackets loads (design §2.1).
export default function Loading() {
  return (
    <div className="cu-loading" aria-busy="true" aria-live="polite">
      <div className="cu-skel cu-skel-h" />
      <div className="cu-skel cu-skel-bar" />
      <div className="cu-skel-grid">
        <div className="cu-skel cu-skel-card" />
        <div className="cu-skel cu-skel-card" />
      </div>
      <span className="cu-sr">Loading the bracket…</span>
    </div>
  );
}
