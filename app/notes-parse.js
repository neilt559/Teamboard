// The notes markup parser (see notes-format.js), in a plain module with no 'use client' and no imports, so Server
// Components (the A11 owner report sheet) and client code (the editor, Copy for email) read the text the same way.
//   %t Title / %h Header / "- " bullet (2 spaces per sub-level) / anything else text; blank lines are gaps.
const INDENT = '  ';
const MAX_LEVEL = 4;

export function parseNotes(text) {
  return String(text || '').split('\n').map((line) => {
    let m;
    if ((m = /^\s*%t\s?(.*)$/i.exec(line))) return { type: 'title', text: m[1] };
    if ((m = /^\s*%h\s?(.*)$/i.exec(line))) return { type: 'header', text: m[1] };
    if ((m = /^([ \t]*)-\s+(.*)$/.exec(line))) {
      const width = m[1].replace(/\t/g, INDENT).length;
      return { type: 'bullet', text: m[2], level: Math.min(MAX_LEVEL, Math.floor(width / INDENT.length)) };
    }
    if (!line.trim()) return { type: 'gap' };
    return { type: 'text', text: line };
  });
}
