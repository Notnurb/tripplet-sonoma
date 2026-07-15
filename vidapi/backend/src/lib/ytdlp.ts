import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export interface SimpleFormat {
  formatId: string;
  label: string;
  ext: string;
  type: "video" | "audio";
  filesize: number | null;
}

export interface MediaInfo {
  title: string;
  thumbnail: string | null;
  duration: number | null;
  uploader: string | null;
  formats: SimpleFormat[];
}

function run(
  args: string[],
  timeoutMs = 30_000
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("yt-dlp", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timed out"));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        const lastLine = stderr.trim().split("\n").pop();
        reject(new Error(lastLine || `yt-dlp exited with code ${code}`));
      }
    });
  });
}

export async function getInfo(url: string): Promise<MediaInfo> {
  const { stdout } = await run([
    "--dump-json",
    "--no-playlist",
    "--no-warnings",
    url,
  ]);

  const data = JSON.parse(stdout.trim().split("\n")[0]);
  const seen = new Set<string>();
  const formats: SimpleFormat[] = [];

  for (const f of data.formats ?? []) {
    if (!f.format_id) continue;
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";
    if (!hasVideo && !hasAudio) continue;

    let label: string;
    let type: "video" | "audio";

    if (hasVideo) {
      type = "video";
      const res = f.height ? `${f.height}p` : f.format_note || f.resolution || "video";
      label = `${res} · ${(f.ext || "mp4").toUpperCase()}${hasAudio ? "" : " (no audio)"}`;
    } else {
      type = "audio";
      const abr = f.abr ? `${Math.round(f.abr)}kbps` : "audio";
      label = `${abr} · ${(f.ext || "m4a").toUpperCase()}`;
    }

    const key = `${type}:${label}`;
    if (seen.has(key)) continue;
    seen.add(key);

    formats.push({
      formatId: f.format_id,
      label,
      ext: f.ext || (type === "video" ? "mp4" : "m4a"),
      type,
      filesize: f.filesize ?? f.filesize_approx ?? null,
    });
  }

  formats.unshift({
    formatId: "best",
    label: "Best quality · MP4",
    ext: "mp4",
    type: "video",
    filesize: null,
  });
  formats.push({
    formatId: "mp3",
    label: "MP3 (audio only)",
    ext: "mp3",
    type: "audio",
    filesize: null,
  });

  return {
    title: data.title ?? "download",
    thumbnail: data.thumbnail ?? null,
    duration: data.duration ?? null,
    uploader: data.uploader ?? null,
    formats,
  };
}

const FORMAT_ID_RE = /^[a-zA-Z0-9+_\-/.]+$/;

export function isValidFormatId(id: string): boolean {
  return id.length > 0 && id.length <= 64 && FORMAT_ID_RE.test(id);
}

export interface DownloadResult {
  filePath: string;
  fileName: string;
  cleanup: () => void;
}

export async function downloadToTemp(
  url: string,
  formatId: string,
  type: "video" | "audio"
): Promise<DownloadResult> {
  const dir = await mkdtemp(path.join(tmpdir(), "vidapi-"));
  const outTemplate = path.join(dir, "%(title).100B.%(ext)s");

  const args = [
    "--no-playlist",
    "--no-warnings",
    "--restrict-filenames",
    "-o",
    outTemplate,
  ];

  if (type === "audio") {
    args.push(
      "-f",
      formatId === "mp3" ? "bestaudio/best" : formatId,
      "-x",
      "--audio-format",
      "mp3"
    );
  } else {
    const fmt = formatId === "best" ? "bestvideo*+bestaudio/best" : formatId;
    args.push("-f", fmt, "--merge-output-format", "mp4");
  }

  args.push(url);

  try {
    await run(args, 10 * 60 * 1000);
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }

  const files = await readdir(dir);
  if (files.length === 0) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error("Download produced no output file");
  }

  const fileName = files[0];
  const filePath = path.join(dir, fileName);
  const cleanup = () => {
    void rm(dir, { recursive: true, force: true }).catch(() => {});
  };

  return { filePath, fileName, cleanup };
}
