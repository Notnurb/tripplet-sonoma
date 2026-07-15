const ALLOWED_HOSTS = [
  "youtube.com",
  "youtu.be",
  "m.youtube.com",
  "tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "reddit.com",
  "old.reddit.com",
  "redd.it",
];

export function assertAllowedUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("That doesn't look like a valid URL");
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("URL must use http or https");
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const isAllowed = ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );

  if (!isAllowed) {
    throw new Error("That platform isn't supported yet");
  }

  return parsed;
}
