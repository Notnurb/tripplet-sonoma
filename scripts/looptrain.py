#!/usr/bin/env python3

import argparse
import json
import os
import queue
import random
import string
import threading
import time
import urllib.request
from pathlib import Path

USER_AGENT = "TriplepediaTrainer/1.0 (https://tripplet.ai; contact@tripplet.ai)"
RANDOM_BATCH = 50
QUEUE_TARGET = 300
DEFAULT_RPS = 5.0
DEFAULT_CONCURRENCY = 8


def load_env():
    root = Path.cwd()
    candidates = [
        ".env.local",
        ".env",
        ".env.development.local",
        ".env.development",
    ]
    for name in candidates:
        path = root / name
        if not path.exists():
            continue
        for line in path.read_text().splitlines():
            trimmed = line.strip()
            if not trimmed or trimmed.startswith("#"):
                continue
            if "=" not in trimmed:
                continue
            key, value = trimmed.split("=", 1)
            key = key.strip()
            value = value.strip().strip("\"").strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


def http_json(url, method="GET", data=None, headers=None, timeout=20):
    headers = headers or {}
    headers.setdefault("User-Agent", USER_AGENT)
    if data is not None:
        body = json.dumps(data).encode("utf-8")
        headers.setdefault("Content-Type", "application/json")
    else:
        body = None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)


def fetch_random_titles(limit):
    url = f"https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit={limit}"
    try:
        data = http_json(url)
        return [item["title"] for item in data.get("query", {}).get("random", [])]
    except Exception:
        pass

    fallback = f"https://en.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=random&rnnamespace=0&rnlimit={limit}"
    try:
        data = http_json(fallback)
        return [item["title"] for item in data.get("query", {}).get("random", [])]
    except Exception:
        pass

    opensearch = f"https://en.wikipedia.org/w/api.php?action=opensearch&limit={limit}&namespace=0&format=json&search=the"
    data = http_json(opensearch)
    titles = data[1] if isinstance(data, list) and len(data) > 1 else []
    return titles


def random_slug_suffix():
    return "".join(random.choice(string.ascii_lowercase + string.digits) for _ in range(6))


def slugify(text):
    lowered = "".join(ch.lower() if ch.isalnum() or ch.isspace() or ch == "-" else "" for ch in text)
    return "-".join(lowered.strip().split())


class RateLimiter:
    def __init__(self, rps):
        self.interval = 1.0 / max(rps, 0.1)
        self.lock = threading.Lock()
        self.next_allowed = time.monotonic()

    def wait(self):
        with self.lock:
            now = time.monotonic()
            if now < self.next_allowed:
                delay = self.next_allowed - now
                self.next_allowed += self.interval
            else:
                delay = 0
                self.next_allowed = now + self.interval
        if delay > 0:
            time.sleep(delay)


def main():
    load_env()
    parser = argparse.ArgumentParser(description="Looptrain Triplepedia via local Python")
    parser.add_argument("--rps", type=float, default=DEFAULT_RPS)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--count", type=int, default=0)
    parser.add_argument("--base-url", type=str, default=os.environ.get("LOCAL_APP_URL", "http://localhost:3000"))
    parser.add_argument("--submitted-by", type=str, default=os.environ.get("SUBMITTED_BY"))
    args = parser.parse_args()

    # Articles are inserted through the app's own API route (which writes to Neon),
    # so no direct database credentials are needed here — just the running app.
    insert_url = f"{args.base_url.rstrip('/')}/api/triplepedia/articles"

    limiter = RateLimiter(args.rps)
    q = queue.Queue()
    stop = threading.Event()

    stats = {"processed": 0, "inserted": 0, "failed": 0}
    stats_lock = threading.Lock()

    def producer():
        while not stop.is_set():
            if args.count > 0 and stats["processed"] >= args.count:
                break
            if q.qsize() < QUEUE_TARGET:
                needed = max(1, QUEUE_TARGET - q.qsize())
                titles = fetch_random_titles(min(needed, RANDOM_BATCH))
                for title in titles:
                    q.put(f"https://en.wikipedia.org/wiki/{urllib.request.quote(title.replace(' ', '_'))}")
            else:
                time.sleep(0.1)

    def worker():
        while not stop.is_set():
            if args.count > 0 and stats["processed"] >= args.count:
                break
            try:
                url = q.get(timeout=1)
            except queue.Empty:
                continue
            limiter.wait()
            try:
                extract = http_json(
                    f"{args.base_url}/api/triplepedia/extract",
                    method="POST",
                    data={"url": url},
                )

                slug = f"{slugify(extract.get('title') or 'article')}-{int(time.time())}-{random_slug_suffix()}"
                payload = {
                    "title": extract.get("title") or "",
                    "slug": slug,
                    "summary": extract.get("summary") or "",
                    "sections": extract.get("sections") or [],
                    "infobox": (extract.get("infobox") or []) + [{"label": "Source", "value": extract.get("sourceUrl") or url}],
                    "submitted_by": args.submitted_by,
                    "fact_checked_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                    "status": "published",
                }

                http_json(
                    insert_url,
                    method="POST",
                    data=payload,
                )
                with stats_lock:
                    stats["inserted"] += 1
            except Exception:
                with stats_lock:
                    stats["failed"] += 1
            finally:
                with stats_lock:
                    stats["processed"] += 1
                    processed = stats["processed"]
                    inserted = stats["inserted"]
                    failed = stats["failed"]
                if processed % 25 == 0:
                    print(f"processed {processed} | inserted {inserted} | failed {failed}")
                q.task_done()

        stop.set()

    threads = []
    threads.append(threading.Thread(target=producer, daemon=True))
    threads[-1].start()

    for _ in range(max(1, args.concurrency)):
        t = threading.Thread(target=worker, daemon=True)
        t.start()
        threads.append(t)

    try:
        while any(t.is_alive() for t in threads):
            time.sleep(0.5)
            if args.count > 0 and stats["processed"] >= args.count:
                stop.set()
                break
    except KeyboardInterrupt:
        stop.set()

    for t in threads:
        t.join(timeout=1)

    print(f"Done. processed {stats['processed']} | inserted {stats['inserted']} | failed {stats['failed']}")


if __name__ == "__main__":
    main()
