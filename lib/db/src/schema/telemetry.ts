import { index, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Anonymous product events and scrubbed crash reports from the iPhone app.
 * No device, user or customer identifiers and no IP addresses: only fixed names.
 */
export const telemetryTable = pgTable(
  "telemetry",
  {
    id: serial("id").primaryKey(),
    /** "event" or "crash". */
    kind: text("kind").notNull(),
    /** The event name, or the app area for a crash. */
    name: text("name").notNull(),
    /** Where the paywall was opened from, or the error type for a crash. */
    detail: text("detail"),
    appVersion: text("app_version").notNull(),
    platform: text("platform").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("telemetry_kind_name_idx").on(t.kind, t.name), index("telemetry_created_idx").on(t.createdAt)],
);

export type TelemetryRow = typeof telemetryTable.$inferSelect;
