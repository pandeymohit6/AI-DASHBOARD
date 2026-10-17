import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "./db.js";
import { requireAuth, requireRevenueRole } from "./auth.js";
import { generateSuggestions } from "./ai.js";

const app = express();
app.use(helmet());
app.use(
  cors({
    origin: (process.env.WEB_ORIGIN || "http://localhost:5173").split(","),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "100kb" }));
app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "degraded" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const schema = z.object({
    email: z.string().email().max(254),
    password: z.string().min(1).max(128),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "INVALID_INPUT" });
  const result = await pool.query(
    "SELECT id, tenant_id, email, password_hash, role FROM users WHERE email=$1",
    [parsed.data.email.toLowerCase()],
  );
  const user = result.rows[0];
  // Demo account uses the seeded password hash; replace this login path with your production identity provider.
  if (
    !user ||
    !(await bcrypt.compare(parsed.data.password, user.password_hash))
  )
    return res.status(401).json({ error: "INVALID_CREDENTIALS" });
  const token = jwt.sign(
    { sub: user.id, tenantId: user.tenant_id, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "8h", issuer: "staywise-api", audience: "staywise-web" },
  );
  res.json({
    token,
    user: { id: user.id, email: user.email, role: user.role },
  });
});

app.use("/api", requireAuth);
app.get("/api/dashboard", async (req, res) => {
  const property = await pool.query(
    "SELECT id,name,currency,timezone FROM properties WHERE tenant_id=$1 ORDER BY name LIMIT 1",
    [req.user.tenantId],
  );
  if (!property.rowCount)
    return res.status(404).json({ error: "PROPERTY_NOT_FOUND" });
  const p = property.rows[0];
  const rooms = await pool.query(
    "SELECT id,name,base_rate,min_rate,max_rate,capacity FROM room_types WHERE tenant_id=$1 AND property_id=$2 ORDER BY name",
    [req.user.tenantId, p.id],
  );
  const demand = await pool.query(
    `SELECT d.room_type_id, r.name AS room_type_name, d.stay_date, d.rooms_available, d.rooms_booked, d.pickup_7d, d.local_event_score
    FROM daily_demand d JOIN room_types r ON r.id=d.room_type_id AND r.tenant_id=d.tenant_id
    WHERE d.tenant_id=$1 AND d.property_id=$2 AND d.stay_date BETWEEN CURRENT_DATE AND CURRENT_DATE+13
    ORDER BY d.stay_date, r.name`,
    [req.user.tenantId, p.id],
  );
  res.json({ property: p, roomTypes: rooms.rows, demand: demand.rows });
});

const requestSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
app.post("/api/rate-suggestions", requireRevenueRole, async (req, res) => {
  const parsed = requestSchema.safeParse(req.body);
  if (!parsed.success)
    return res.status(400).json({ error: "INVALID_DATE_RANGE" });
  const { startDate, endDate } = parsed.data;
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86400000;
  if (days < 0 || days > 30)
    return res.status(400).json({ error: "DATE_RANGE_MUST_BE_0_TO_30_DAYS" });
  const property = await pool.query(
    "SELECT id FROM properties WHERE tenant_id=$1 ORDER BY name LIMIT 1",
    [req.user.tenantId],
  );
  if (!property.rowCount)
    return res.status(404).json({ error: "PROPERTY_NOT_FOUND" });
  const inserted = await pool.query(
    `INSERT INTO rate_suggestion_jobs(tenant_id,property_id,requested_by,start_date,end_date,status)
    VALUES($1,$2,$3,$4,$5,'queued') RETURNING id,status,created_at`,
    [req.user.tenantId, property.rows[0].id, req.user.id, startDate, endDate],
  );
  res.status(202).json({
    jobId: inserted.rows[0].id,
    status: inserted.rows[0].status,
    createdAt: inserted.rows[0].created_at,
  });
});

app.get("/api/rate-suggestions/:jobId", async (req, res) => {
  if (!z.string().uuid().safeParse(req.params.jobId).success)
    return res.status(400).json({ error: "INVALID_JOB_ID" });
  const result = await pool.query(
    `SELECT id,status,provider,result,error_code,created_at,started_at,completed_at
    FROM rate_suggestion_jobs WHERE id=$1 AND tenant_id=$2`,
    [req.params.jobId, req.user.tenantId],
  );
  if (!result.rowCount) return res.status(404).json({ error: "JOB_NOT_FOUND" });
  res.json(result.rows[0]);
});

// Single-process worker for a runnable demo. A production deployment should use durable queue workers with leases/retries.
let workerBusy = false;
async function processOneJob() {
  if (workerBusy) return;
  workerBusy = true;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    const next =
      await client.query(`SELECT * FROM rate_suggestion_jobs WHERE status='queued' ORDER BY created_at
      FOR UPDATE SKIP LOCKED LIMIT 1`);
    if (!next.rowCount) {
      await client.query("COMMIT");
      return;
    }
    const job = next.rows[0];
    await client.query(
      "UPDATE rate_suggestion_jobs SET status='processing',started_at=now() WHERE id=$1",
      [job.id],
    );
    await client.query("COMMIT");
    const [rooms, demand] = await Promise.all([
      pool.query(
        "SELECT id,name,base_rate,min_rate,max_rate FROM room_types WHERE tenant_id=$1 AND property_id=$2",
        [job.tenant_id, job.property_id],
      ),
      pool.query(
        `SELECT room_type_id,stay_date,rooms_available,rooms_booked,pickup_7d,local_event_score FROM daily_demand
        WHERE tenant_id=$1 AND property_id=$2 AND stay_date BETWEEN $3 AND $4 ORDER BY stay_date`,
        [job.tenant_id, job.property_id, job.start_date, job.end_date],
      ),
    ]);
    const generated = await generateSuggestions(rooms.rows, demand.rows);
    const roomNames = Object.fromEntries(rooms.rows.map((r) => [r.id, r.name]));
    const suggestions = generated.suggestions.map((s) => ({
      ...s,
      roomTypeName: roomNames[s.roomTypeId],
    }));
    await pool.query(
      `UPDATE rate_suggestion_jobs SET status='completed',provider=$2,result=$3::jsonb,completed_at=now(),
      input_summary=$4::jsonb WHERE id=$1 AND tenant_id=$5`,
      [
        job.id,
        generated.provider,
        JSON.stringify({ suggestions }),
        JSON.stringify({
          dateCount: demand.rowCount,
          roomTypeCount: rooms.rowCount,
        }),
        job.tenant_id,
      ],
    );
  } catch (err) {
    console.error("Suggestion worker error:", err.message);
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch {}
    }
    // Mark a stuck processing job failed if the worker threw after claim.
    try {
      await pool.query(
        `UPDATE rate_suggestion_jobs SET status='failed',error_code='PROCESSING_FAILED',completed_at=now() WHERE status='processing' AND completed_at IS NULL AND started_at < now()-interval '1 minute'`,
      );
    } catch {}
  } finally {
    client?.release();
    workerBusy = false;
  }
}
setInterval(processOneJob, 700);
processOneJob();

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "INTERNAL_ERROR" });
});
const port = Number(process.env.PORT || 4000);
app.listen(port, () => console.log(`StayWise API listening on ${port}`));
