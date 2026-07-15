

export const index = 2;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_page.svelte.js')).default;
export const imports = ["_app/immutable/nodes/2.BENeQZ20.js","_app/immutable/chunks/B7VdhWLQ.js","_app/immutable/chunks/DLOGHgSB.js"];
export const stylesheets = [];
export const fonts = [];
