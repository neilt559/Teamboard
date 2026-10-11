import { CULTURE_CHALLENGES } from './culture-challenges.js';
import { CULTURE_EVENTS } from './culture-events.js';

// Release 3 schema, split in two files so the challenge and calendar agents never
// edit the same one.
export const CULTURE = [...CULTURE_CHALLENGES, ...CULTURE_EVENTS];
