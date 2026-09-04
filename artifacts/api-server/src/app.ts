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
// CORS_ORIGIN can optionally restrict the portal to a comma-separated origin list.
// Keep reflected origins by default so Replit deployments and previews continue to work.
const corsOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim())
  : true; // true = reflect any origin

app.use(cors({ origin: corsOrigins, credentials: true }));
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
