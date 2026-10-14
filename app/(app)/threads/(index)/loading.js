import SpaceLoading from '../_components/SpaceLoading';

// Skeleton while /threads loads. It sits in the (index) route group so it wraps the space list only: the space
// pages keep a real HTTP 404 for a space you can't read (a loading boundary would stream it as a 200).
export default function ThreadsLoading() {
  return <SpaceLoading index />;
}
