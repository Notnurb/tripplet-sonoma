

export const index = 1;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/fallbacks/error.svelte.js')).default;
export const imports = ["_app/immutable/nodes/1.BW6Yb4LP.js","_app/immutable/chunks/B7VdhWLQ.js","_app/immutable/chunks/DLOGHgSB.js","_app/immutable/chunks/D3BlZpNH.js"];
export const stylesheets = [];
export const fonts = [];
