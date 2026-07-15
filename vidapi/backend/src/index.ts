import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { assertAllowedUrl } from "./lib/validate-url.js";
import { getInfo, downloadToTemp, isValidFormatId } from "./lib/ytdlp.js";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN?.split(",") ?? "*",
  })
);

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use("/api", limiter);

app.post("/api/info", async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || !url.trim()) {
    res.status(400).json({ error: "A URL is required" });
    return;
  }

  try {
    assertAllowedUrl(url.trim());
    const info = await getInfo(url.trim());
    res.json(info);
  } catch (err) {
    res
      .status(422)
      .json({ error: err instanceof Error ? err.message : "Could not process that link" });
  }
});

app.get("/api/download", async (req, res) => {
  const url = String(req.query.url ?? "");
  const formatId = String(req.query.formatId ?? "");
  const type = req.query.type === "audio" ? "audio" : "video";

  if (!url || !formatId || !isValidFormatId(formatId)) {
    res.status(400).json({ error: "Missing or invalid parameters" });
    return;
  }

  try {
    assertAllowedUrl(url);
  } catch (err) {
    res
      .status(422)
      .json({ error: err instanceof Error ? err.message : "Unsupported URL" });
    return;
  }

  let cleanup: (() => void) | undefined;
  try {
    const result = await downloadToTemp(url, formatId, type);
    cleanup = result.cleanup;
    res.download(result.filePath, result.fileName, (err) => {
      cleanup?.();
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    });
  } catch (err) {
    cleanup?.();
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : "Download failed" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`vidapi backend listening on :${port}`);
});
