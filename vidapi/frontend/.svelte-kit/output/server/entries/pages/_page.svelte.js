import { c as create_ssr_component, d as add_attribute, e as escape } from "../../chunks/ssr.js";
const Page = create_ssr_component(($$result, $$props, $$bindings, slots) => {
  let url = "";
  return `<main><div class="wrap"><h1 data-svelte-h="svelte-v4h7q5">vidapi</h1> <p class="tagline" data-svelte-h="svelte-schrk9">Paste a link. Get your file. No ads, no tracking, no nonsense.</p> <form><input type="text" placeholder="Paste a YouTube, TikTok, X, Instagram, or Reddit link…" autofocus${add_attribute("value", url)}> <button type="submit" ${!url.trim() ? "disabled" : ""}>${escape("Get download")}</button></form> ${``} ${``} <footer data-svelte-h="svelte-13i9yvd"><p>No ads. No trackers. No accounts. Just your files.</p></footer></div></main>`;
});
export {
  Page as default
};
