import * as React from 'react';
import { notFound } from 'next/navigation';
import { requirePageViewer } from '@/lib/viewer';
import { nowFromRequestContext } from '@/lib/clock';
import { loadProjectPage } from '@/lib/queries/project';
import { projectTitle } from '@/lib/projects';
import ProjectBoard from './ProjectBoard';

// /projects/[projectId] (design §2.1): the project board for anyone who can see the project (tb_can_see_project:
// a member, an L2 in the project's office, PMs and up, admins). Anything else is the same 404 as a project that
// doesn't exist. An archived project renders read-only with Restore for people who may manage it.
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

const ID = /^[0-9]{1,18}$/;
const cache = typeof React.cache === 'function' ? React.cache : (fn) => fn;
// One "now" per request (A6: upcoming meetings' past flag and the default meeting date use today in Central; the
// local test clock applies), so the metadata and the page share the loader's cached read.
const requestNow = cache(() => nowFromRequestContext());

// No loading.js for this segment on purpose: in Next 14.2 a loading boundary starts streaming with HTTP 200
// before the page runs, so a hidden or missing project would answer 200 instead of 404 (§14.2). The loader
// is cached per request, so the page reuses this read.
export async function generateMetadata({ params }) {
  const viewer = await requirePageViewer();
  const data = ID.test(String(params.projectId)) ? await loadProjectPage(viewer, String(params.projectId), requestNow()) : null;
  if (!data) notFound();
  return { title: projectTitle(data.project) };
}

export default async function ProjectPage({ params }) {
  const viewer = await requirePageViewer();
  if (!ID.test(String(params.projectId))) notFound();
  const data = await loadProjectPage(viewer, String(params.projectId), requestNow());
  if (!data) notFound();
  return <ProjectBoard key={data.project.id} initial={data} />;
}
