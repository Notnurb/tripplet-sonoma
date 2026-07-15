<script lang="ts">
  import { fetchInfo, downloadUrl, type MediaInfo, type MediaFormat } from "$lib/api";

  let url = "";
  let loading = false;
  let error = "";
  let info: MediaInfo | null = null;

  async function handleSubmit() {
    const trimmed = url.trim();
    if (!trimmed) return;

    error = "";
    info = null;
    loading = true;
    try {
      info = await fetchInfo(trimmed);
    } catch (e) {
      error = e instanceof Error ? e.message : "Something went wrong";
    } finally {
      loading = false;
    }
  }

  function formatSize(bytes: number | null): string {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(0)} MB`;
  }

  function formatDuration(seconds: number | null): string {
    if (!seconds) return "";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${s}`;
  }

  $: videoFormats = info?.formats.filter((f) => f.type === "video") ?? [];
  $: audioFormats = info?.formats.filter((f) => f.type === "audio") ?? [];
</script>

<main>
  <div class="wrap">
    <h1>vidapi</h1>
    <p class="tagline">Paste a link. Get your file. No ads, no tracking, no nonsense.</p>

    <form on:submit|preventDefault={handleSubmit}>
      <input
        type="text"
        placeholder="Paste a YouTube, TikTok, X, Instagram, or Reddit link…"
        bind:value={url}
        autofocus
      />
      <button type="submit" disabled={loading || !url.trim()}>
        {loading ? "Fetching…" : "Get download"}
      </button>
    </form>

    {#if error}
      <p class="error">{error}</p>
    {/if}

    {#if info}
      <section class="result">
        <div class="meta">
          {#if info.thumbnail}
            <img src={info.thumbnail} alt="" />
          {/if}
          <div>
            <h2>{info.title}</h2>
            <p class="sub">
              {info.uploader ?? ""}{info.uploader && info.duration ? " · " : ""}{formatDuration(
                info.duration
              )}
            </p>
          </div>
        </div>

        {#if videoFormats.length}
          <div class="group">
            <h3>Video</h3>
            <div class="options">
              {#each videoFormats as f (f.formatId + f.label)}
                <a class="option" href={downloadUrl(url.trim(), f)}>
                  <span>{f.label}</span>
                  {#if f.filesize}<span class="size">{formatSize(f.filesize)}</span>{/if}
                </a>
              {/each}
            </div>
          </div>
        {/if}

        {#if audioFormats.length}
          <div class="group">
            <h3>Audio</h3>
            <div class="options">
              {#each audioFormats as f (f.formatId + f.label)}
                <a class="option" href={downloadUrl(url.trim(), f)}>
                  <span>{f.label}</span>
                  {#if f.filesize}<span class="size">{formatSize(f.filesize)}</span>{/if}
                </a>
              {/each}
            </div>
          </div>
        {/if}
      </section>
    {/if}

    <footer>
      <p>No ads. No trackers. No accounts. Just your files.</p>
    </footer>
  </div>
</main>
