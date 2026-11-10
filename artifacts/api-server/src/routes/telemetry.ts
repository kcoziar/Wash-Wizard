import { Router, type IRouter } from "express";
import { RecordCrashBody, RecordEventBody } from "@workspace/api-zod";
import { db, telemetryTable } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Anonymous telemetry from the iPhone app. Bodies must match the fixed lists exactly; anything
 * else is refused. Nothing that could identify a person or device is read or stored, including
 * the IP address.
 */
const router: IRouter = Router();

// A simple ceiling per server process so a misbehaving client cannot flood the table.
const LIMIT_PER_MINUTE = 600;
let windowStart = Date.now();
let count = 0;
function allow(): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    count = 0;
  }
  count += 1;
  return count <= LIMIT_PER_MINUTE;
}

router.post("/telemetry/events", async (req, res) => {
  const body = RecordEventBody.strict().safeParse(req.body);
  if (!body.success) {
    res.status(400).end();
    return;
  }
  if (!allow()) {
    res.status(429).end();
    return;
  }
  try {
    await db.insert(telemetryTable).values({
      kind: "event",
      name: body.data.event,
      detail: body.data.event === "paywall_viewed" ? (body.data.from ?? "other") : null,
      appVersion: body.data.appVersion,
      platform: body.data.platform,
    });
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "telemetry event insert failed");
    res.status(500).end();
  }
});

router.post("/telemetry/crashes", async (req, res) => {
  const body = RecordCrashBody.strict().safeParse(req.body);
  if (!body.success) {
    res.status(400).end();
    return;
  }
  if (!allow()) {
    res.status(429).end();
    return;
  }
  try {
    await db.insert(telemetryTable).values({
      kind: "crash",
      name: body.data.area,
      detail: body.data.errorType,
      appVersion: body.data.appVersion,
      platform: body.data.platform,
    });
    res.status(204).end();
  } catch (err) {
    logger.error({ err }, "telemetry crash insert failed");
    res.status(500).end();
  }
});

export default router;
