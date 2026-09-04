import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { startGpsPoller } from "./lib/gpstrace.js";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const defaultCorsOrigins = [
  "https://invendisapp.com",
  "https://www.invendisapp.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const corsOrigins = new Set(
  (process.env.CORS_ORIGIN?.split(",") ?? defaultCorsOrigins)
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean),
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(
    "Permissions-Policy",
    "camera=(self), geolocation=(self), microphone=()",
  );
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.supabase.co https://*.amazonaws.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "worker-src 'self' blob:",
    ].join("; "),
  );
  next();
});

app.use(
  cors({
    credentials: true,
    origin(origin, callback) {
      // Requests without Origin are server-to-server or same-origin navigation.
      if (!origin || corsOrigins.has(origin.replace(/\/$/, ""))) {
        callback(null, true);
        return;
      }
      const error = new Error("Origin is not allowed by CORS") as Error & {
        status: number;
      };
      error.status = 403;
      callback(error);
    },
  }),
);
// Raw body buffer for the GPS retranslator webhook — must come BEFORE json() middleware
// so binary sutran payloads are not corrupted by JSON parsing attempts.
app.use("/api/gps/retranslator", express.raw({ type: "*/*", limit: "64kb" }));
// Raw body buffer for the upload proxy — receives binary photo data from the field app.
app.use("/api/upload-proxy", express.raw({ type: "*/*", limit: "20mb" }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(router);

// Start GPS poller if any GPS-Trace token is configured
const _hasGpsToken =
  process.env["GPS_TRACE_API_TOKEN"] ||
  process.env["GPS_TRACE_API_TOKEN_2"] ||
  process.env["GPS_TRACE_TOKEN"] ||
  process.env["GPSTRACE_TOKEN"];
if (_hasGpsToken) {
  startGpsPoller(30_000);
}

export default app;
