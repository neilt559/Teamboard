import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';
import { sql as libSql, ensureSchema } from '@/lib/db';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// TEMPORARY diagnostic. Reveals exactly what the Neon driver returns so we can
// see where reads break. Delete once the board works.
export async function GET() {
  const out = { steps: {} };
  try {
    const cs =
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      process.env.POSTGRES_PRISMA_URL;
    out.host = cs ? new URL(cs).host : 'NO_CONNECTION_STRING';
    out.envPresent = {
      DATABASE_URL: !!process.env.DATABASE_URL,
      POSTGRES_URL: !!process.env.POSTGRES_URL,
      POSTGRES_PRISMA_URL: !!process.env.POSTGRES_PRISMA_URL,
    };

    await ensureSchema();

    // Insert a row so there is definitely data to read.
    const sqlFull = neon(cs, { fullResults: true });
    const ins = await sqlFull`INSERT INTO projects (name, position) VALUES ('__diag_probe__', ${Date.now()}) RETURNING id`;
    const insId = ins && ins.rows ? ins.rows[0].id : (Array.isArray(ins) ? ins[0]?.id : null);
    out.steps.insertReturnedId = insId;

    // (A) via our lib wrapper, exactly like /api/state does
    const libSel = await libSql`SELECT id, name FROM projects ORDER BY position ASC, id ASC`;
    out.steps.libWrapper = {
      resultType: typeof libSel,
      keys: libSel && typeof libSel === 'object' && !Array.isArray(libSel) ? Object.keys(libSel) : null,
      hasRows: !!(libSel && libSel.rows),
      rowsLen: libSel && libSel.rows ? libSel.rows.length : null,
      isArray: Array.isArray(libSel),
      arrLen: Array.isArray(libSel) ? libSel.length : null,
    };

    // (B) direct neon, fullResults
    const dFull = await sqlFull`SELECT id, name FROM projects ORDER BY id`;
    out.steps.directFullResults = {
      hasRows: !!(dFull && dFull.rows),
      rowsLen: dFull && dFull.rows ? dFull.rows.length : null,
      isArray: Array.isArray(dFull),
    };

    // (C) direct neon, default (returns array of rows)
    const sqlPlain = neon(cs);
    const dPlain = await sqlPlain`SELECT id, name FROM projects ORDER BY id`;
    out.steps.directPlain = {
      isArray: Array.isArray(dPlain),
      len: Array.isArray(dPlain) ? dPlain.length : null,
      sample: Array.isArray(dPlain) ? dPlain.slice(0, 3) : dPlain,
    };

    // (D) count for sanity
    const cnt = await sqlPlain`SELECT count(*)::int AS c FROM projects`;
    out.steps.count = Array.isArray(cnt) ? cnt[0].c : (cnt.rows ? cnt.rows[0].c : null);

    // cleanup the probe row
    if (insId) await sqlFull`DELETE FROM projects WHERE id=${insId}`;
  } catch (e) {
    out.error = e.message;
    out.stack = (e.stack || '').split('\n').slice(0, 4);
  }
  return NextResponse.json(out);
}
