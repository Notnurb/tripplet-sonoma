const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8787";

export interface MediaFormat {
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
  formats: MediaFormat[];
}

export async function fetchInfo(url: string): Promise<MediaInfo> {
  const res = await fetch(`${API_BASE}/api/info`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error ?? "Something went wrong");
  }
  return data as MediaInfo;
}

export function downloadUrl(sourceUrl: string, format: MediaFormat): string {
  const params = new URLSearchParams({
    url: sourceUrl,
    formatId: format.formatId,
    type: format.type,
  });
  return `${API_BASE}/api/download?${params.toString()}`;
}
