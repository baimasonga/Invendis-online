/**
 * Production static file server for the web portal.
 * Used by Railway (and any other host) to serve the Vite build output.
 * No extra npm packages required — pure Node.js built-ins only.
 */
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { resolve, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const distDir = resolve(__dirname, "dist/public");
const port = Number(process.env.PORT || 3000);

const MIME = {
  ".html":  "text/html; charset=utf-8",
  ".js":    "application/javascript; charset=utf-8",
  ".mjs":   "application/javascript; charset=utf-8",
  ".css":   "text/css; charset=utf-8",
  ".json":  "application/json",
  ".png":   "image/png",
  ".jpg":   "image/jpeg",
  ".jpeg":  "image/jpeg",
  ".gif":   "image/gif",
  ".svg":   "image/svg+xml",
  ".ico":   "image/x-icon",
  ".woff":  "font/woff",
  ".woff2": "font/woff2",
  ".ttf":   "font/ttf",
  ".webp":  "image/webp",
  ".map":   "application/json",
};

function tryFile(filePath) {
  try {
    const stat = statSync(filePath);
    if (stat.isFile()) return readFileSync(filePath);
  } catch { /* not found */ }
  return null;
}

createServer((req, res) => {
  const rawPath = req.url.split("?")[0];

  // Security: prevent path traversal
  const safePath = resolve(distDir, "." + rawPath);
  if (!safePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  let content = tryFile(safePath);
  let resolvedExt = extname(safePath);

  // Try index.html for directory requests
  if (!content) {
    const indexPath = join(safePath, "index.html");
    content = tryFile(indexPath);
    resolvedExt = ".html";
  }

  // SPA fallback — serve root index.html for all unmatched paths
  if (!content) {
    content = tryFile(resolve(distDir, "index.html"));
    resolvedExt = ".html";
  }

  if (!content) {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, {
    "Content-Type": MIME[resolvedExt] || "application/octet-stream",
    "Cache-Control": resolvedExt === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  res.end(content);
}).listen(port, () => {
  console.log(`Invendis web portal serving on port ${port}`);
});
