import express, { Express, Request, Response, NextFunction } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getPool, closePool, getPoolStats, sql } from "./db";
import {
  ROOM_TYPE_MAP,
  DEPARTMENT_TYPE_MAP,
  getRoomTypeName,
  getDepartmentTypeName,
  CALL_STATUS_MAP,
  getCallStatusMeta,
  isValidCallStatus,
  withCallStatusFields,
  withCallTypeFields,
  MISCELLANEOUS_CALL_TYPE,
  isCallRecordActive,
  getCallTypeName,
} from "./constants";

dotenv.config();

const USER_TABLE = process.env.USER_TABLE || 'User';
const ORGANISATION_TABLE = process.env.ORGANISATION_TABLE || 'Organisation';
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const SUPER_ADMIN_ROLE = 'super_admin';

interface AuthRequest extends Request {
  authUser?: { id: string; role: string };
}

function requireSuperAdmin(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }
  try {
    const token = authHeader.slice(7);
    const payload = jwt.verify(token, JWT_SECRET) as { id: string; role: string };
    if (payload.role !== SUPER_ADMIN_ROLE) {
      return res.status(403).json({ success: false, error: 'Forbidden: super admin only' });
    }
    req.authUser = payload;
    next();
  } catch {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}


const app: Express = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" }
});
const PORT = process.env.PORT || 5001;

// Repeated call logging (minimal, additive)
// IMPORTANT: This service user may not have DDL permissions in production.
// So we only *use* CallRepeat table if it already exists.
let callRepeatTableCache: boolean | null = null;
let activityLogTableCache: boolean | null = null;
let resolvedManuallyColumnCache: boolean | null = null;
const ACTIVITY_LOG_TABLE = "ActivityLog";

type ActivityLogInput = {
  organisationId?: string | null;
  organisationName?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  message: string;
  actorId?: string | null;
  actorName?: string | null;
  details?: Record<string, unknown>;
};

async function hasResolvedManuallyColumn(pool: Awaited<ReturnType<typeof getPool>>): Promise<boolean> {
  if (resolvedManuallyColumnCache !== null) return resolvedManuallyColumnCache;
  try {
    const r = await pool.request().query(`SELECT COL_LENGTH(OBJECT_ID(N'[dbo].[CallStatus]'), 'resolvedManually') AS colLen`);
    resolvedManuallyColumnCache = (r?.recordset?.[0]?.colLen ?? null) != null;
    return resolvedManuallyColumnCache;
  } catch {
    resolvedManuallyColumnCache = false;
    return false;
  }
}

function isResolvedManuallyValue(value: unknown): boolean | null {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  return null;
}

function mapResolvedManually(row: {
  resolvedManually?: boolean | number | null;
  resolveAction?: string | null;
  dateTimeReset?: Date | string | null;
}): boolean | null {
  const fromColumn = isResolvedManuallyValue(row.resolvedManually);
  if (fromColumn !== null) return fromColumn;
  if (row.resolveAction === "call.resolved.dashboard") return true;
  if (row.resolveAction === "call.resolved" || row.dateTimeReset) return false;
  return null;
}

/** Activity-log action written when a device beacon closes a call. */
const BEACON_RESOLVE_ACTION = "call.resolved.beacon";

/**
 * Who actually closed the call: the device panel, a nurse on the dashboard, or
 * a beacon sweep that found it already cleared on the device. The beacon case
 * is only visible in the activity log - resolvedManually is a bit and already
 * spends both its values on device/dashboard - so a site without the
 * ActivityLog table reads a beacon resolve as a plain device reset.
 */
function mapResolveSource(row: {
  resolvedManually?: boolean | number | null;
  resolveAction?: string | null;
  dateTimeReset?: Date | string | null;
}): "beacon" | "dashboard" | "device" | null {
  if (row.resolveAction === BEACON_RESOLVE_ACTION) return "beacon";
  if (row.resolveAction === "call.resolved.dashboard") return "dashboard";
  if (isResolvedManuallyValue(row.resolvedManually) === true) return "dashboard";
  if (row.resolveAction === "call.resolved") return "device";
  if (row.dateTimeReset) return "device";
  return null;
}

async function hasActivityLogTable(pool: Awaited<ReturnType<typeof getPool>>): Promise<boolean> {
  if (activityLogTableCache !== null) return activityLogTableCache;
  try {
    const r = await pool.request().query(`SELECT OBJECT_ID(N'[dbo].[ActivityLog]', N'U') AS objId`);
    activityLogTableCache = !!r?.recordset?.[0]?.objId;
    return activityLogTableCache;
  } catch {
    activityLogTableCache = false;
    return false;
  }
}

// Organisation names are looked up on every activity-log write, which is once
// per device call. Cache them briefly so that lookup is not a per-call query.
const ORG_NAME_TTL_MS = 5 * 60 * 1000;
const orgNameCache = new Map<string, { name: string; expiresAt: number }>();

async function getOrganisationName(pool: Awaited<ReturnType<typeof getPool>>, orgId?: string | null) {
  if (!orgId) return null;
  const cached = orgNameCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.name;
  try {
    const r = await pool.request()
      .input("id", sql.NVarChar(50), orgId)
      .query(`SELECT name FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    const name = r.recordset[0]?.name || orgId;
    orgNameCache.set(orgId, { name, expiresAt: Date.now() + ORG_NAME_TTL_MS });
    return name;
  } catch {
    return orgId;
  }
}

async function writeActivityLog(pool: Awaited<ReturnType<typeof getPool>>, entry: ActivityLogInput) {
  if (!(await hasActivityLogTable(pool))) return;
  try {
    const orgName = entry.organisationName ?? (entry.organisationId ? await getOrganisationName(pool, entry.organisationId) : null);
    const id = `LOG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const insertReq = pool.request();
    insertReq.input("id", sql.NVarChar(50), id);
    insertReq.input("organisationId", sql.NVarChar(50), entry.organisationId || null);
    insertReq.input("organisationName", sql.NVarChar(200), orgName || null);
    insertReq.input("action", sql.NVarChar(100), entry.action);
    insertReq.input("entityType", sql.NVarChar(50), entry.entityType || null);
    insertReq.input("entityId", sql.NVarChar(50), entry.entityId || null);
    insertReq.input("message", sql.NVarChar(1000), entry.message.slice(0, 1000));
    insertReq.input("actorId", sql.NVarChar(50), entry.actorId || null);
    insertReq.input("actorName", sql.NVarChar(200), entry.actorName || null);
    insertReq.input("details", sql.NVarChar(sql.MAX), entry.details ? JSON.stringify(entry.details) : null);
    insertReq.input("createdAt", sql.DateTime, new Date());
    await insertReq.query(
      `INSERT INTO [${ACTIVITY_LOG_TABLE}]
       (id, organisationId, organisationName, action, entityType, entityId, message, actorId, actorName, details, createdAt)
       VALUES (@id, @organisationId, @organisationName, @action, @entityType, @entityId, @message, @actorId, @actorName, @details, @createdAt)`
    );
  } catch (err) {
    console.error("[ActivityLog] write failed:", err);
  }
}

async function hasCallRepeatTable(pool: any): Promise<boolean> {
  if (callRepeatTableCache !== null) return callRepeatTableCache;
  try {
    const r = await pool.request().query(`SELECT OBJECT_ID(N'[dbo].[CallRepeat]', N'U') AS objId`);
    callRepeatTableCache = !!r?.recordset?.[0]?.objId;
    return callRepeatTableCache;
  } catch (err) {
    console.error('[CallRepeat] Table existence check failed:', err);
    callRepeatTableCache = false;
    return false;
  }
}

// ---------------------------------------------------------------------------
// Organisation hardware IDs (HIDs)
//
// An organisation can own several devices, so its HIDs live in their own table
// instead of the single [Organisation].hid column. That column is kept in sync
// with the first HID so anything still reading it keeps working.
//
// As with CallRepeat, the service user may not have DDL rights in production:
// we try to create the table once, and every caller degrades to the legacy
// single-column behaviour when it is not there. See migrations/organisation-hid.sql
// for the statements to run by hand in that case.
const ORGANISATION_HID_TABLE = "OrganisationHid";
let organisationHidTableCache: boolean | null = null;
let organisationHidListColumnCache: boolean | null = null;

// Comma-joined copy of the organisation's whole HID list, repeated on each of
// its rows, for readers that want every HID in one column instead of a join.
// The rows stay the source of truth: this column is derived, and every write
// goes through setOrganisationHidList() so it cannot drift away from them.
const ORGANISATION_HID_LIST_COLUMN = "hids";

/**
 * Rewrites the `hids` column for one organisation from its own rows, so the
 * derived column always matches them. Safe to call when the column is absent.
 */
async function setOrganisationHidList(pool: any, organisationId: string) {
  if (!(await ensureOrganisationHidListColumn(pool))) return;
  const request = pool.request();
  request.input("organisationId", sql.NVarChar(50), organisationId);
  await request.query(
    `UPDATE h
        SET h.[${ORGANISATION_HID_LIST_COLUMN}] = a.hidList
       FROM [${ORGANISATION_HID_TABLE}] h
       CROSS APPLY (
         SELECT STRING_AGG(x.hid, ',') WITHIN GROUP (ORDER BY x.id) AS hidList
           FROM [${ORGANISATION_HID_TABLE}] x
          WHERE x.organisationId = h.organisationId
       ) a
      WHERE h.organisationId = @organisationId`
  );
}

async function ensureOrganisationHidTable(pool: any): Promise<boolean> {
  if (organisationHidTableCache !== null) return organisationHidTableCache;
  try {
    const existing = await pool
      .request()
      .query(`SELECT OBJECT_ID(N'[dbo].[${ORGANISATION_HID_TABLE}]', N'U') AS objId`);
    if (existing?.recordset?.[0]?.objId) {
      organisationHidTableCache = true;
      return true;
    }
  } catch (err) {
    console.error("[OrganisationHid] Table existence check failed:", err);
    organisationHidTableCache = false;
    return false;
  }

  try {
    await pool.request().query(
      `CREATE TABLE [dbo].[${ORGANISATION_HID_TABLE}] (
         id INT IDENTITY(1,1) NOT NULL PRIMARY KEY,
         organisationId NVARCHAR(50) NOT NULL,
         hid NVARCHAR(20) NOT NULL,
         ${ORGANISATION_HID_LIST_COLUMN} NVARCHAR(MAX) NULL,
         createdAt DATETIME NOT NULL CONSTRAINT DF_OrganisationHid_createdAt DEFAULT GETDATE()
       );
       CREATE INDEX IX_OrganisationHid_organisationId
         ON [dbo].[${ORGANISATION_HID_TABLE}] (organisationId);`
    );
    // Carry the existing single HIDs over so nothing disappears from the admin
    // page the first time this runs.
    await pool.request().query(
      `INSERT INTO [dbo].[${ORGANISATION_HID_TABLE}] (organisationId, hid, ${ORGANISATION_HID_LIST_COLUMN})
       SELECT id, CONVERT(NVARCHAR(20), hid), CONVERT(NVARCHAR(20), hid)
         FROM [${ORGANISATION_TABLE}] WHERE hid IS NOT NULL`
    );
    console.log("[OrganisationHid] Table created and backfilled");
    organisationHidTableCache = true;
    organisationHidListColumnCache = true;
    return true;
  } catch (err) {
    console.error(
      "[OrganisationHid] Table creation failed, falling back to the single Organisation.hid column:",
      err
    );
    organisationHidTableCache = false;
    return false;
  }
}

/**
 * Adds the derived `hids` column to an existing table, backfilling it from the
 * rows. Like the table itself this needs DDL rights: without them we log once
 * and every caller simply leaves the column alone.
 */
async function ensureOrganisationHidListColumn(pool: any): Promise<boolean> {
  if (organisationHidListColumnCache !== null) return organisationHidListColumnCache;
  if (!(await ensureOrganisationHidTable(pool))) {
    organisationHidListColumnCache = false;
    return false;
  }
  try {
    const existing = await pool
      .request()
      .query(
        `SELECT COL_LENGTH(N'[dbo].[${ORGANISATION_HID_TABLE}]', N'${ORGANISATION_HID_LIST_COLUMN}') AS colLen`
      );
    if (existing?.recordset?.[0]?.colLen != null) {
      organisationHidListColumnCache = true;
      return true;
    }
  } catch (err) {
    console.error("[OrganisationHid] hids column check failed:", err);
    organisationHidListColumnCache = false;
    return false;
  }

  try {
    await pool.request().query(
      `ALTER TABLE [dbo].[${ORGANISATION_HID_TABLE}]
         ADD ${ORGANISATION_HID_LIST_COLUMN} NVARCHAR(MAX) NULL`
    );
    // Mark it usable before backfilling: the backfill goes through the same
    // UPDATE the write path uses, which checks this flag.
    organisationHidListColumnCache = true;
    await pool.request().query(
      `UPDATE h
          SET h.[${ORGANISATION_HID_LIST_COLUMN}] = a.hidList
         FROM [${ORGANISATION_HID_TABLE}] h
         CROSS APPLY (
           SELECT STRING_AGG(x.hid, ',') WITHIN GROUP (ORDER BY x.id) AS hidList
             FROM [${ORGANISATION_HID_TABLE}] x
            WHERE x.organisationId = h.organisationId
         ) a`
    );
    console.log("[OrganisationHid] hids column added and backfilled");
    return true;
  } catch (err) {
    console.error(
      "[OrganisationHid] Could not add the hids column, leaving it unmanaged:",
      err
    );
    organisationHidListColumnCache = false;
    return false;
  }
}

const HID_PATTERN = /^\d{10}$/;

/**
 * Accepts either the new `hids: string[]` payload or the legacy scalar `hid`,
 * and returns the cleaned, de-duplicated list.
 */
function normaliseHidPayload(body: { hids?: unknown; hid?: unknown }):
  | { ok: true; hids: string[] }
  | { ok: false; error: string } {
  const raw = Array.isArray(body.hids)
    ? body.hids
    : body.hids != null
      ? [body.hids]
      : body.hid != null
        ? [body.hid]
        : [];

  const hids: string[] = [];
  for (const entry of raw) {
    const value = String(entry ?? "").trim();
    if (!value) continue;
    if (!HID_PATTERN.test(value)) {
      return { ok: false, error: `hid must be a 10-digit number (got "${value}")` };
    }
    if (!hids.includes(value)) hids.push(value);
  }
  return { ok: true, hids };
}

/** HIDs per organisation, keyed by organisation id. */
async function getOrganisationHids(pool: any, organisationId?: string): Promise<Map<string, string[]>> {
  const byOrg = new Map<string, string[]>();
  if (!(await ensureOrganisationHidTable(pool))) return byOrg;
  const request = pool.request();
  let query = `SELECT organisationId, hid FROM [${ORGANISATION_HID_TABLE}]`;
  if (organisationId) {
    request.input("organisationId", sql.NVarChar(50), organisationId);
    query += ` WHERE organisationId = @organisationId`;
  }
  query += ` ORDER BY organisationId, id`;
  const result = await request.query(query);
  for (const row of result.recordset) {
    const list = byOrg.get(row.organisationId) || [];
    list.push(String(row.hid));
    byOrg.set(row.organisationId, list);
  }
  return byOrg;
}

/** Adds `hids` to an organisation row, falling back to its own `hid` column. */
function withHids(org: any, byOrg: Map<string, string[]>) {
  const stored = byOrg.get(org.id);
  const hids = stored && stored.length ? stored : org.hid != null ? [String(org.hid)] : [];
  return { ...org, hid: hids[0] ?? null, hids };
}

/** Rejects HIDs already claimed by a different organisation. */
async function findConflictingHid(
  pool: any,
  organisationId: string,
  hids: string[]
): Promise<string | null> {
  if (!hids.length) return null;
  const request = pool.request();
  request.input("organisationId", sql.NVarChar(50), organisationId);
  const params = hids.map((hid, i) => {
    request.input(`hid${i}`, sql.NVarChar(20), hid);
    return `@hid${i}`;
  });

  if (await ensureOrganisationHidTable(pool)) {
    const inTable = await request.query(
      `SELECT TOP 1 hid FROM [${ORGANISATION_HID_TABLE}]
       WHERE organisationId <> @organisationId AND hid IN (${params.join(", ")})`
    );
    if (inTable.recordset.length) return String(inTable.recordset[0].hid);
    return null;
  }

  const inColumn = await request.query(
    `SELECT TOP 1 hid FROM [${ORGANISATION_TABLE}]
     WHERE id <> @organisationId AND CONVERT(NVARCHAR(20), hid) IN (${params.join(", ")})`
  );
  return inColumn.recordset.length ? String(inColumn.recordset[0].hid) : null;
}

/**
 * Replaces an organisation's HIDs. [Organisation].hid keeps the first one so
 * existing readers of that column still see a valid device id.
 */
async function saveOrganisationHids(pool: any, organisationId: string, hids: string[]) {
  if (!(await ensureOrganisationHidTable(pool))) return;
  const deleteReq = pool.request();
  deleteReq.input("organisationId", sql.NVarChar(50), organisationId);
  await deleteReq.query(`DELETE FROM [${ORGANISATION_HID_TABLE}] WHERE organisationId = @organisationId`);
  for (const hid of hids) {
    const insertReq = pool.request();
    insertReq.input("organisationId", sql.NVarChar(50), organisationId);
    insertReq.input("hid", sql.NVarChar(20), hid);
    await insertReq.query(
      `INSERT INTO [${ORGANISATION_HID_TABLE}] (organisationId, hid) VALUES (@organisationId, @hid)`
    );
  }
  // Rebuild the derived list column from the rows we just wrote.
  await setOrganisationHidList(pool, organisationId);
}

// Middleware
app.use(cors());
app.use(express.json());

// Socket.io connection
io.on("connection", (socket) => {
  // Join organization room if orgId is provided
  socket.on("joinOrg", (orgId) => {
    if (orgId) {
      socket.join(`org_${orgId}`);
    }
  });
});

// Sample data storage (in-memory for now)
interface Room {
  id: string;
  name: string;
  floorNumber: number;
  department: string;
  type: string;
}

interface User {
  id: string;
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

interface Call {
  id: string;
  roomId: string;
  status: "active" | "pending" | "resolved";
  timestamp: Date;
  minutesAgo: number;
  muted?: boolean;
}

let rooms: Room[] = [
  {
    id: "R001",
    name: "Room A",
    floorNumber: 1,
    department: "Intensive Care",
    type: "Emergency",
  },
  {
    id: "R002",
    name: "Room B",
    floorNumber: 2,
    department: "General Ward",
    type: "General",
  },
  {
    id: "R003",
    name: "Room C",
    floorNumber: 3,
    department: "Surgery",
    type: "ICU",
  },
];

let activeCalls: Call[] = [
  {
    id: "C001",
    roomId: "R001",
    status: "active",
    timestamp: new Date(Date.now() - 2 * 60000),
    minutesAgo: 2,
    muted: false,
  },
  {
    id: "C002",
    roomId: "R002",
    status: "active",
    timestamp: new Date(Date.now() - 5 * 60000),
    minutesAgo: 5,
    muted: false,
  },
];

// Authentication Routes
// Authentication with MSSQL
app.post("/api/auth/register", async (req: Request, res: Response) => {
  try {
    const { id, organisationId, name, address, password, email, role } = req.body;

    // Log incoming request body (mask password)
    try {
      const logged = { ...req.body, password: password ? '***masked***' : undefined };
      console.log('[REG] Incoming register request:', JSON.stringify(logged));
    } catch (logErr) {
      console.log('[REG] Incoming register request (could not stringify)');
    }

    if (!id || !organisationId || !name || !password || !role) {
      return res.status(400).json({ error: "id, organisationId, name, password and role are required" });
    }

    const pool = await getPool();

    // Check if user already exists by id or email
    const checkReq = pool.request();
    checkReq.input("id", sql.NVarChar(50), id);
    checkReq.input("email", sql.NVarChar(200), email || null);
    const existsQuery = `SELECT id FROM [${USER_TABLE}] WHERE id = @id OR (email IS NOT NULL AND email = @email)`;
    console.log('[REG] existsQuery:', existsQuery);
    const existsResult = await checkReq.query(existsQuery);
    console.log('[REG] existsResult:', existsResult && existsResult.recordset ? existsResult.recordset : existsResult);

    if (existsResult.recordset.length > 0) {
      console.log('[REG] user exists -> aborting');
      return res.status(409).json({ error: "User with given id or email already exists" });
    }

    const hashed = await bcrypt.hash(password, 10);

    const insertReq = pool.request();
    insertReq.input("id", sql.NVarChar(50), id);
    insertReq.input("organisationId", sql.NVarChar(50), organisationId);
    insertReq.input("name", sql.NVarChar(200), name);
    insertReq.input("address", sql.NVarChar(500), address || null);
    insertReq.input("password", sql.NVarChar(200), hashed);
    insertReq.input("email", sql.NVarChar(200), email || null);
    insertReq.input("role", sql.VarChar(50), role);

    const insertQuery = `INSERT INTO [${USER_TABLE}] (id, organisationId, name, address, password, email, role) VALUES (@id, @organisationId, @name, @address, @password, @email, @role)`;
    console.log('[REG] Running insert:', insertQuery.replace(process.env.DB_PASSWORD || '', ''));
    const insertResult = await insertReq.query(insertQuery);
    console.log('[REG] insertResult:', insertResult && insertResult.rowsAffected ? insertResult.rowsAffected : insertResult);

    const token = jwt.sign({ id, role }, JWT_SECRET, { expiresIn: '8h' });

    return res.status(201).json({ success: true, data: { id, organisationId, name, email, role }, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

app.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const pool = await getPool();
    const r = pool.request();
    r.input('email', sql.NVarChar(200), email);
    const result = await r.query(`SELECT id, password, name, role, organisationId, email FROM [${USER_TABLE}] WHERE email = @email`);

    if (result.recordset.length === 0) return res.status(401).json({ error: 'Invalid credentials' });

    const user = result.recordset[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '8h' });

    await writeActivityLog(pool, {
      organisationId: user.organisationId,
      action: "auth.login",
      entityType: "user",
      entityId: user.id,
      message: `User logged in: ${user.email || user.name}`,
      actorId: user.id,
      actorName: user.name,
    });

    return res.status(200).json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, organisationId: user.organisationId }, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Super admin - organisations & users
app.get("/api/admin/organisations", requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT id, name, address, phoneNo, contactPerson, hid FROM [${ORGANISATION_TABLE}] ORDER BY id`
    );
    const hidsByOrg = await getOrganisationHids(pool);
    return res.status(200).json({
      success: true,
      data: result.recordset.map((org: any) => withHids(org, hidsByOrg)),
    });
  } catch (err) {
    console.error("[ADMIN ORGANISATIONS GET] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch organisations" });
  }
});

app.post("/api/admin/organisations", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, name, address, phoneNo, contactPerson } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: "id and name are required" });
    }
    const parsedHids = normaliseHidPayload(req.body);
    if (!parsedHids.ok) {
      return res.status(400).json({ success: false, error: parsedHids.error });
    }
    const hids = parsedHids.hids;
    const hidStr = hids[0] ?? null;
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    if (exists.recordset.length > 0) {
      return res.status(409).json({ success: false, error: "Organisation with this id already exists" });
    }
    const conflict = await findConflictingHid(pool, id, hids);
    if (conflict) {
      return res.status(409).json({
        success: false,
        error: `Hardware ID ${conflict} is already assigned to another organisation`,
      });
    }
    const insertReq = pool.request();
    insertReq.input("id", sql.NVarChar(50), id);
    insertReq.input("name", sql.NVarChar(200), name);
    insertReq.input("address", sql.NVarChar(500), address || null);
    insertReq.input("phoneNo", sql.NVarChar(50), phoneNo || null);
    insertReq.input("contactPerson", sql.NVarChar(200), contactPerson || null);
    insertReq.input("hid", sql.NVarChar(20), hidStr);
    await insertReq.query(
      `INSERT INTO [${ORGANISATION_TABLE}] (id, name, address, phoneNo, contactPerson, hid)
       VALUES (@id, @name, @address, @phoneNo, @contactPerson, @hid)`
    );
    await saveOrganisationHids(pool, id, hids);
    await writeActivityLog(pool, {
      organisationId: id,
      organisationName: name,
      action: "organisation.created",
      entityType: "organisation",
      entityId: id,
      message: `Organisation created: ${name}`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
      details: { hids },
    });
    return res.status(201).json({
      success: true,
      data: { id, name, address: address || null, phoneNo: phoneNo || null, contactPerson: contactPerson || null, hid: hidStr, hids },
    });
  } catch (err) {
    console.error("[ADMIN ORGANISATIONS POST] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to create organisation" });
  }
});

app.put("/api/admin/organisations/:id", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, address, phoneNo, contactPerson } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: "name is required" });
    }
    const parsedHids = normaliseHidPayload(req.body);
    if (!parsedHids.ok) {
      return res.status(400).json({ success: false, error: parsedHids.error });
    }
    const hids = parsedHids.hids;
    const hidStr = hids[0] ?? null;
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    if (!exists.recordset.length) {
      return res.status(404).json({ success: false, error: "Organisation not found" });
    }
    const conflict = await findConflictingHid(pool, id, hids);
    if (conflict) {
      return res.status(409).json({
        success: false,
        error: `Hardware ID ${conflict} is already assigned to another organisation`,
      });
    }
    const updateReq = pool.request();
    updateReq.input("id", sql.NVarChar(50), id);
    updateReq.input("name", sql.NVarChar(200), name);
    updateReq.input("address", sql.NVarChar(500), address || null);
    updateReq.input("phoneNo", sql.NVarChar(50), phoneNo || null);
    updateReq.input("contactPerson", sql.NVarChar(200), contactPerson || null);
    updateReq.input("hid", sql.NVarChar(20), hidStr);
    await updateReq.query(
      `UPDATE [${ORGANISATION_TABLE}]
       SET name = @name, address = @address, phoneNo = @phoneNo, contactPerson = @contactPerson, hid = @hid
       WHERE id = @id`
    );
    await saveOrganisationHids(pool, id, hids);
    orgNameCache.set(id, { name, expiresAt: Date.now() + ORG_NAME_TTL_MS });
    await writeActivityLog(pool, {
      organisationId: id,
      organisationName: name,
      action: "organisation.updated",
      entityType: "organisation",
      entityId: id,
      message: `Organisation updated: ${name}`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
      details: { hids },
    });
    return res.status(200).json({
      success: true,
      data: { id, name, address: address || null, phoneNo: phoneNo || null, contactPerson: contactPerson || null, hid: hidStr, hids },
    });
  } catch (err) {
    console.error("[ADMIN ORGANISATIONS PUT] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to update organisation" });
  }
});

app.delete("/api/admin/organisations/:id", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id, name FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    if (!exists.recordset.length) {
      return res.status(404).json({ success: false, error: "Organisation not found" });
    }
    const orgName = exists.recordset[0].name;
    const users = await pool.request()
      .input("organisationId", sql.NVarChar(50), id)
      .query(`SELECT COUNT(*) AS cnt FROM [${USER_TABLE}] WHERE organisationId = @organisationId`);
    if (users.recordset[0]?.cnt > 0) {
      return res.status(409).json({ success: false, error: "Cannot delete organisation with linked users" });
    }
    await saveOrganisationHids(pool, id, []);
    await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`DELETE FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    orgNameCache.delete(id);
    await writeActivityLog(pool, {
      organisationId: id,
      organisationName: orgName,
      action: "organisation.deleted",
      entityType: "organisation",
      entityId: id,
      message: `Organisation deleted: ${orgName}`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
    });
    return res.status(200).json({ success: true, message: "Organisation deleted" });
  } catch (err) {
    console.error("[ADMIN ORGANISATIONS DELETE] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete organisation" });
  }
});

app.get("/api/admin/users", requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT u.id, u.name, u.email, u.role, u.organisationId, u.address, o.name AS organisationName
       FROM [${USER_TABLE}] u
       LEFT JOIN [${ORGANISATION_TABLE}] o ON u.organisationId = o.id
       ORDER BY u.name`
    );
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("[ADMIN USERS GET] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch users" });
  }
});

app.put("/api/admin/users/:id", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role, organisationId, address, password } = req.body;
    if (!name || !role || !organisationId) {
      return res.status(400).json({ success: false, error: "name, role and organisationId are required" });
    }
    const roleNorm = String(role).toLowerCase() === "super_admin"
      ? "super_admin"
      : String(role).toLowerCase() === "admin" || String(role).toUpperCase() === "A"
        ? "admin"
        : "user";
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id, role FROM [${USER_TABLE}] WHERE id = @id`);
    if (!exists.recordset.length) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const orgExists = await pool.request()
      .input("organisationId", sql.NVarChar(50), organisationId)
      .query(`SELECT id FROM [${ORGANISATION_TABLE}] WHERE id = @organisationId`);
    if (!orgExists.recordset.length) {
      return res.status(400).json({ success: false, error: "Organisation not found" });
    }
    if (email) {
      const emailCheck = await pool.request()
        .input("id", sql.NVarChar(50), id)
        .input("email", sql.NVarChar(200), email)
        .query(`SELECT id FROM [${USER_TABLE}] WHERE email = @email AND id <> @id`);
      if (emailCheck.recordset.length > 0) {
        return res.status(409).json({ success: false, error: "Email already in use" });
      }
    }
    const updateReq = pool.request();
    updateReq.input("id", sql.NVarChar(50), id);
    updateReq.input("name", sql.NVarChar(200), name);
    updateReq.input("email", sql.NVarChar(200), email || null);
    updateReq.input("role", sql.VarChar(50), roleNorm);
    updateReq.input("organisationId", sql.NVarChar(50), organisationId);
    updateReq.input("address", sql.NVarChar(500), address || null);
    let updateQuery = `UPDATE [${USER_TABLE}]
       SET name = @name, email = @email, role = @role, organisationId = @organisationId, address = @address`;
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      updateReq.input("password", sql.NVarChar(200), hashed);
      updateQuery += `, password = @password`;
    }
    updateQuery += ` WHERE id = @id`;
    await updateReq.query(updateQuery);
    await writeActivityLog(pool, {
      organisationId,
      action: "user.updated",
      entityType: "user",
      entityId: id,
      message: `User updated: ${name} (${roleNorm})`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
      details: { email, organisationId, role: roleNorm },
    });
    return res.status(200).json({
      success: true,
      data: { id, name, email: email || null, role: roleNorm, organisationId, address: address || null },
    });
  } catch (err) {
    console.error("[ADMIN USERS PUT] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to update user" });
  }
});

app.delete("/api/admin/users/:id", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    if (req.authUser?.id === id) {
      return res.status(400).json({ success: false, error: "Cannot delete your own account" });
    }
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT u.id, u.name, u.organisationId, o.name AS organisationName FROM [${USER_TABLE}] u LEFT JOIN [${ORGANISATION_TABLE}] o ON u.organisationId = o.id WHERE u.id = @id`);
    if (!exists.recordset.length) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const deletedUser = exists.recordset[0];
    await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`DELETE FROM [${USER_TABLE}] WHERE id = @id`);
    await writeActivityLog(pool, {
      organisationId: deletedUser.organisationId,
      organisationName: deletedUser.organisationName,
      action: "user.deleted",
      entityType: "user",
      entityId: id,
      message: `User deleted: ${deletedUser.name}`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
    });
    return res.status(200).json({ success: true, message: "User deleted" });
  } catch (err) {
    console.error("[ADMIN USERS DELETE] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to delete user" });
  }
});

// Super admin - activity log (all organisations)
app.get("/api/admin/logs", requireSuperAdmin, async (req: Request, res: Response) => {
  try {
    const { organisationId, action, startDate, endDate, search, page = 1, pageSize = 50 } = req.query;
    const pool = await getPool();
    if (!(await hasActivityLogTable(pool))) {
      return res.status(503).json({
        success: false,
        error: "ActivityLog table missing. Run backend/migrations/add-activity-log.sql",
        data: [],
        totalCount: 0,
        totalPages: 0,
      });
    }
    const where: string[] = [];
    const params: { name: string; type: any; value: unknown }[] = [];
    if (organisationId) {
      where.push("organisationId = @organisationId");
      params.push({ name: "organisationId", type: sql.NVarChar(50), value: String(organisationId) });
    }
    if (action) {
      where.push("action = @action");
      params.push({ name: "action", type: sql.NVarChar(100), value: String(action) });
    }
    if (startDate) {
      where.push("createdAt >= @startDate");
      params.push({ name: "startDate", type: sql.DateTime, value: new Date(String(startDate)) });
    }
    if (endDate) {
      where.push("createdAt <= @endDate");
      params.push({ name: "endDate", type: sql.DateTime, value: new Date(String(endDate)) });
    }
    if (search) {
      where.push("(message LIKE @search OR organisationName LIKE @search OR entityId LIKE @search)");
      params.push({ name: "search", type: sql.NVarChar, value: `%${search}%` });
    }
    const whereClause = where.length ? ` WHERE ${where.join(" AND ")}` : "";
    const countReq = pool.request();
    const dataReq = pool.request();
    params.forEach((p) => {
      countReq.input(p.name, p.type, p.value);
      dataReq.input(p.name, p.type, p.value);
    });
    const countResult = await countReq.query(`SELECT COUNT(*) AS total FROM [${ACTIVITY_LOG_TABLE}]${whereClause}`);
    const totalCount = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / Number(pageSize));
    const offset = (Number(page) - 1) * Number(pageSize);
    const result = await dataReq.query(
      `SELECT id, organisationId, organisationName, action, entityType, entityId, message, actorId, actorName, details, createdAt
       FROM [${ACTIVITY_LOG_TABLE}]${whereClause}
       ORDER BY createdAt DESC
       OFFSET ${offset} ROWS FETCH NEXT ${Number(pageSize)} ROWS ONLY`
    );
    return res.status(200).json({
      success: true,
      data: result.recordset,
      totalCount,
      totalPages,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (err) {
    console.error("[ADMIN LOGS GET] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch activity logs" });
  }
});

// Organisation lookup
app.get("/api/organisations/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id, name, address, phoneNo, contactPerson, hid FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    if (!result.recordset.length) {
      return res.status(404).json({ success: false, error: "Organisation not found" });
    }
    const hidsByOrg = await getOrganisationHids(pool, id);
    return res.status(200).json({ success: true, data: withHids(result.recordset[0], hidsByOrg) });
  } catch (err) {
    console.error("[ORGANISATIONS GET/:id] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch organisation" });
  }
});

// Room Management Routes (MSSQL-backed)
const ROOM_TABLE = 'Room';

// ---------------------------------------------------------------------------
// Room hardware ID (HID)
//
// [Room].hid records which of the organisation's devices owns the room, and it
// is what a device call is routed by: organisation + HID + device number. Device
// numbers (r01, r02, ...) restart on every device, so the HID is the only thing
// that makes "r01" unambiguous once an organisation runs more than one device.
// Floor plays no part in the lookup - it is descriptive only.
//
// The column is added on demand: as with CallRepeat and OrganisationHid the
// service user may have no DDL rights in production, so every caller falls back
// to the old organisation + device number behaviour without it.
const ROOM_HID_COLUMN = "hid";
let roomHidColumnCache: boolean | null = null;

async function ensureRoomHidColumn(pool: any): Promise<boolean> {
  if (roomHidColumnCache !== null) return roomHidColumnCache;
  try {
    const existing = await pool
      .request()
      .query(`SELECT COL_LENGTH(N'[dbo].[${ROOM_TABLE}]', N'${ROOM_HID_COLUMN}') AS colLen`);
    if (existing?.recordset?.[0]?.colLen != null) {
      roomHidColumnCache = true;
      return true;
    }
  } catch (err) {
    console.error("[Room] hid column check failed:", err);
    roomHidColumnCache = false;
    return false;
  }

  try {
    await pool
      .request()
      .query(`ALTER TABLE [dbo].[${ROOM_TABLE}] ADD ${ROOM_HID_COLUMN} NVARCHAR(20) NULL`);
    console.log("[Room] hid column added");
    roomHidColumnCache = true;
    return true;
  } catch (err) {
    console.error("[Room] Could not add the hid column, rooms stay HID-less:", err);
    roomHidColumnCache = false;
    return false;
  }
}

/**
 * Validates the optional `hid` on a room payload. A blank value clears it, so
 * single-device sites can leave the field alone.
 */
function normaliseRoomHid(value: unknown):
  | { ok: true; hid: string | null }
  | { ok: false; error: string } {
  if (value === undefined || value === null || value === "") return { ok: true, hid: null };
  const hid = String(value).trim();
  if (!HID_PATTERN.test(hid)) {
    return { ok: false, error: `hid must be a 10-digit number (got "${hid}")` };
  }
  return { ok: true, hid };
}

/**
 * Device numbers are scoped to a device, so every HID may reuse the same set -
 * r01 on 2408202601 and r01 on 2408202602 are two different rooms. What must
 * stay unique is the pair the call lookup resolves on: (organisation, hid,
 * device number). A second room on the same HID with the same device number
 * would be picked arbitrarily by `SELECT TOP 1`, so it is rejected here.
 *
 * A NULL hid is treated as its own device: it only clashes with another
 * HID-less room, because an exact HID match always outranks it in the lookup.
 *
 * Returns the clashing room's name, or null when the pair is free.
 */
async function findRoomDeviceNoClash(
  pool: any,
  organisationId: string,
  roomNo_deviceNo: string | null,
  hid: string | null,
  excludeRoomId?: string
): Promise<string | null> {
  if (!roomNo_deviceNo) return null;
  if (!(await ensureRoomHidColumn(pool))) return null;

  const request = pool
    .request()
    .input("organisationId", sql.NVarChar(50), String(organisationId))
    .input("roomNo_deviceNo", sql.NVarChar(100), roomNo_deviceNo)
    .input("hid", sql.NVarChar(20), hid);
  if (excludeRoomId) request.input("excludeId", sql.NVarChar(50), excludeRoomId);

  const clash = await request.query(
    `SELECT TOP 1 roomName FROM [${ROOM_TABLE}]
      WHERE organisationId = @organisationId
        AND roomNo_deviceNo = @roomNo_deviceNo
        AND active = 1
        AND ((${ROOM_HID_COLUMN} = @hid) OR (${ROOM_HID_COLUMN} IS NULL AND @hid IS NULL))
        ${excludeRoomId ? "AND id <> @excludeId" : ""}`
  );
  return clash.recordset.length ? String(clash.recordset[0].roomName) : null;
}

/** The 409 message both room routes return for a clashing device number. */
function roomDeviceNoClashMessage(
  roomNo_deviceNo: string,
  hid: string | null,
  takenBy: string
): string {
  return hid
    ? `Device No ${roomNo_deviceNo} is already used by room "${takenBy}" on HID ${hid}. Pick another device number, or assign this room to a different HID.`
    : `Device No ${roomNo_deviceNo} is already used by room "${takenBy}" among the rooms with no HID. Pick another device number, or assign this room to a HID.`;
}

// GET all rooms
app.get("/api/rooms", async (req: Request, res: Response) => {
  try {
    const { organisationId } = req.query;
    if (!organisationId) {
      return res.status(400).json({ success: false, error: "organisationId is required" });
    }
    const pool = await getPool();
    // Called on every settings-page load, so this is where the column gets
    // added the first time an existing database is upgraded.
    await ensureRoomHidColumn(pool);
    const request = pool.request();
    let query = `SELECT * FROM [${ROOM_TABLE}] WHERE active = 1`;
    request.input('organisationId', sql.NVarChar(50), String(organisationId));
    query += ` AND organisationId = @organisationId`;
    query += ` ORDER BY id`;
    const result = await request.query(query);
    
    // Map room type and department type to readable names
    const mappedRooms = result.recordset.map((room: any) => ({
      ...room,
      roomTypeName: getRoomTypeName(room.roomType),
      departmentTypeName: getDepartmentTypeName(room.departmentType),
    }));
    
    return res.status(200).json({
      success: true,
      data: mappedRooms,
    });
  } catch (err) {
    console.error('[ROOMS GET] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch rooms' });
  }
});

// GET room by ID
app.get("/api/rooms/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await getPool();
    const r = pool.request();
    r.input('id', sql.NVarChar(50), id);
    
    const result = await r.query(`SELECT * FROM [${ROOM_TABLE}] WHERE id = @id`);
    
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, error: 'Room not found' });
    }
    
    const room = result.recordset[0];
    const mappedRoom = {
      ...room,
      roomTypeName: getRoomTypeName(room.roomType),
      departmentTypeName: getDepartmentTypeName(room.departmentType),
    };
    
    return res.status(200).json({
      success: true,
      data: mappedRoom,
    });
  } catch (err) {
    console.error('[ROOMS GET/:id] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch room' });
  }
});

// CREATE room
app.post("/api/rooms", async (req: Request, res: Response) => {
  try {
    const { organisationId, roomName, roomNo_deviceNo, roomType, departmentType, floor } = req.body;

    console.log('[ROOMS POST] Incoming request:', { organisationId, roomName, roomNo_deviceNo, roomType, departmentType });

    if (!organisationId || !roomName || roomType === undefined || departmentType === undefined) {
      console.log('[ROOMS POST] Validation failed');
      return res.status(400).json({
        error: "organisationId, roomName, roomType, departmentType are required"
      });
    }

    const parsedHid = normaliseRoomHid(req.body.hid);
    if (!parsedHid.ok) {
      return res.status(400).json({ success: false, error: parsedHid.error });
    }
    const hid = parsedHid.hid;

    const pool = await getPool();

    const deviceNo = roomNo_deviceNo ? String(roomNo_deviceNo) : null;
    const takenBy = await findRoomDeviceNoClash(pool, organisationId, deviceNo, hid);
    if (takenBy) {
      return res.status(409).json({
        success: false,
        error: roomDeviceNoClashMessage(String(deviceNo), hid, takenBy),
      });
    }

    // Generate unique room ID: ROOM_{timestamp}_{random}
    const roomId = `ROOM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const insertReq = pool.request();
    insertReq.input('id', sql.NVarChar(50), roomId);
    insertReq.input('organisationId', sql.NVarChar(50), organisationId);
    insertReq.input('roomName', sql.NVarChar(200), roomName);
    insertReq.input('roomNo_deviceNo', sql.NVarChar(100), roomNo_deviceNo || null);
    insertReq.input('roomType', sql.Int, roomType);
    insertReq.input('departmentType', sql.Int, departmentType);
    // [Room].floor is NOT NULL and purely descriptive since calls are routed by
    // HID, so an unset floor is stored as 0 rather than rejected.
    insertReq.input('floor', sql.Int, Number.isFinite(Number(floor)) ? Number(floor) : 0);
    insertReq.input('active', sql.Bit, 1);

    const hasHidColumn = await ensureRoomHidColumn(pool);
    if (hasHidColumn) insertReq.input('hid', sql.NVarChar(20), hid);

    const insertQuery = `INSERT INTO [${ROOM_TABLE}] (id, organisationId, roomName, roomNo_deviceNo, roomType, departmentType, floor, active${hasHidColumn ? `, ${ROOM_HID_COLUMN}` : ""})
               VALUES (@id, @organisationId, @roomName, @roomNo_deviceNo, @roomType, @departmentType, @floor, @active${hasHidColumn ? ", @hid" : ""})`;
    
    console.log('[ROOMS POST] Executing query:', insertQuery);
    await insertReq.query(insertQuery);

    console.log('[ROOMS POST] Room created with ID:', roomId);

    await writeActivityLog(pool, {
      organisationId,
      action: "room.created",
      entityType: "room",
      entityId: roomId,
      message: `Room created: ${roomName}`,
      details: { roomNo_deviceNo, floor, roomType, departmentType, hid },
    });

    return res.status(201).json({
      success: true,
      data: { id: roomId, organisationId, roomName, roomNo_deviceNo, roomType, departmentType, hid, active: 1 },
    });
  } catch (err) {
    console.error('[ROOMS POST] Error details:', err);
    const errorMsg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ success: false, error: `Failed to create room: ${errorMsg}` });
  }
});

// UPDATE room
app.put("/api/rooms/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { organisationId, roomName, roomNo_deviceNo, roomType, departmentType, floor, active } = req.body;

    const parsedHid = normaliseRoomHid(req.body.hid);
    if (!parsedHid.ok) {
      return res.status(400).json({ success: false, error: parsedHid.error });
    }
    const hid = parsedHid.hid;

    const pool = await getPool();

    // Check if room exists
    const checkReq = pool.request();
    checkReq.input('id', sql.NVarChar(50), id);
    const existsResult = await checkReq.query(`SELECT id FROM [${ROOM_TABLE}] WHERE id = @id`);
    
    if (existsResult.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    const deviceNo = roomNo_deviceNo ? String(roomNo_deviceNo) : null;
    const takenBy = await findRoomDeviceNoClash(pool, organisationId, deviceNo, hid, id);
    if (takenBy) {
      return res.status(409).json({
        success: false,
        error: roomDeviceNoClashMessage(String(deviceNo), hid, takenBy),
      });
    }

    const updateReq = pool.request();
    updateReq.input('id', sql.NVarChar(50), id);
    updateReq.input('organisationId', sql.NVarChar(50), organisationId);
    updateReq.input('roomName', sql.NVarChar(200), roomName);
    updateReq.input('roomNo_deviceNo', sql.NVarChar(100), roomNo_deviceNo || null);
    updateReq.input('roomType', sql.Int, roomType);
    updateReq.input('departmentType', sql.Int, departmentType);
    updateReq.input('floor', sql.Int, Number.isFinite(Number(floor)) ? Number(floor) : 0);
    updateReq.input('active', sql.Bit, active !== undefined ? active : 1);

    const hasHidColumn = await ensureRoomHidColumn(pool);
    if (hasHidColumn) updateReq.input('hid', sql.NVarChar(20), hid);

    const updateQuery = `UPDATE [${ROOM_TABLE}]
               SET organisationId = @organisationId, roomName = @roomName, roomNo_deviceNo = @roomNo_deviceNo,
                 roomType = @roomType, departmentType = @departmentType, floor = @floor, active = @active${hasHidColumn ? `, ${ROOM_HID_COLUMN} = @hid` : ""}
               WHERE id = @id`;
    
    await updateReq.query(updateQuery);

    await writeActivityLog(pool, {
      organisationId,
      action: "room.updated",
      entityType: "room",
      entityId: id,
      message: `Room updated: ${roomName}`,
      details: { roomNo_deviceNo, floor, roomType, departmentType, hid },
    });

    return res.status(200).json({
      success: true,
      data: { id, organisationId, roomName, roomNo_deviceNo, roomType, departmentType, hid, active },
    });
  } catch (err) {
    console.error('[ROOMS PUT/:id] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to update room' });
  }
});

// DELETE room (soft delete by setting active = 0)
app.delete("/api/rooms/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const pool = await getPool();
    
    // Check if room exists
    const checkReq = pool.request();
    checkReq.input('id', sql.NVarChar(50), id);
    const existsResult = await checkReq.query(`SELECT id, roomName, organisationId FROM [${ROOM_TABLE}] WHERE id = @id`);
    
    if (existsResult.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }
    const deletedRoom = existsResult.recordset[0];

    const deleteReq = pool.request();
    deleteReq.input('id', sql.NVarChar(50), id);
    
    await deleteReq.query(`UPDATE [${ROOM_TABLE}] SET active = 0 WHERE id = @id`);

    await writeActivityLog(pool, {
      organisationId: deletedRoom.organisationId,
      action: "room.deleted",
      entityType: "room",
      entityId: id,
      message: `Room deleted: ${deletedRoom.roomName}`,
    });

    return res.status(200).json({
      success: true,
      message: "Room deleted successfully",
    });
  } catch (err) {
    console.error('[ROOMS DELETE/:id] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to delete room' });
  }
});

// Active Calls Routes
// Fetch active calls from DB (CallStatus table)
app.get("/api/calls/active", async (req: Request, res: Response) => {
  try {
    const { organisationId, hid, floor } = req.query;
    if (!organisationId) {
      return res.status(400).json({ success: false, error: "organisationId is required" });
    }
    console.log('[CALLS ACTIVE] Fetching active calls from DB with room name join', { organisationId, hid, floor });
    const pool = await getPool();
    // hid and floor ride along so the dashboard can split one organisation's
    // calls into per-device or per-floor views without a second round trip.
    const hasHidColumn = await ensureRoomHidColumn(pool);
    const request = pool.request();
    let query =
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[callType], cs.[dateTime], cs.[isMuted], cs.[dateTimeReset], r.[roomName], r.[organisationId], r.[floor]${
        hasHidColumn ? `, r.[${ROOM_HID_COLUMN}] AS [hid]` : `, NULL AS [hid]`
      }
       FROM [CallStatus] cs
       INNER JOIN [Room] r ON cs.[roomId] = r.[id]
       WHERE cs.[currentStatus] <> 0 AND ISNULL(cs.[callType], cs.[currentStatus]) <> ${MISCELLANEOUS_CALL_TYPE}`;
    request.input('organisationId', sql.NVarChar(50), String(organisationId));
    query += ` AND r.[organisationId] = @organisationId`;
    if (hid && hasHidColumn) {
      request.input('hid', sql.NVarChar(20), String(hid));
      query += ` AND r.[${ROOM_HID_COLUMN}] = @hid`;
    }
    if (floor !== undefined && floor !== "") {
      request.input('floor', sql.Int, Number(floor));
      query += ` AND r.[floor] = @floor`;
    }
    query += ` ORDER BY cs.[dateTime] DESC`;
    const result = await request.query(query);
    const now = Date.now();
    const calls = result.recordset.map((row: any) =>
      withCallTypeFields(withCallStatusFields({
        id: row.id,
        roomId: row.roomId,
        roomName: row.roomName || '',
        status: row.currentStatus,
        callType: row.callType ?? row.currentStatus,
        timestamp: row.dateTime,
        minutesAgo: row.dateTime ? Math.floor((now - new Date(row.dateTime).getTime()) / 60000) : null,
        muted: row.isMuted === 1 || row.isMuted === true,
        dateTimeReset: row.dateTimeReset,
        hid: row.hid ?? null,
        floor: row.floor ?? null,
        organisationId: row.organisationId || String(organisationId),
      }))
    );
    res.status(200).json({
      success: true,
      data: calls,
    });
  } catch (err) {
    console.error('[CALLS ACTIVE] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch active calls' });
  }
});

app.post("/api/calls", async (req: Request, res: Response) => {
  const { roomId, organisationId, status } = req.body;
  if (!roomId || !organisationId) {
    return res.status(400).json({ error: "Room ID and organisationId are required" });
  }
  try {
    const pool = await getPool();

    // Reject if there's already an active (non-reset) call for this room
    const activeCallResult = await pool.request()
      .input('roomId', sql.NVarChar(50), roomId)
      .query(`SELECT TOP 1 id, currentStatus, dateTime FROM [CallStatus] WHERE roomId = @roomId AND currentStatus <> 0 ORDER BY dateTime DESC`);

    if (activeCallResult.recordset.length > 0) {
      const existing = activeCallResult.recordset[0];
      return res.status(409).json({
        success: false,
        error: "Call already active for this room",
        existingCallId: existing.id
      });
    }

    const callId = `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const now = new Date();
    const statusNumber = Number(status);
    if (statusNumber === MISCELLANEOUS_CALL_TYPE) {
      const callId = `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
      const now = new Date();
      const insertReq = pool.request();
      insertReq.input("id", sql.NVarChar(50), callId);
      insertReq.input("roomId", sql.NVarChar(50), roomId);
      insertReq.input("currentStatus", sql.Int, 0);
      insertReq.input("callType", sql.Int, MISCELLANEOUS_CALL_TYPE);
      insertReq.input("dateTime", sql.DateTime, now);
      insertReq.input("isMuted", sql.Int, 0);
      insertReq.input("mutedDateTime", sql.DateTime, null);
      insertReq.input("dateTimeReset", sql.DateTime, now);
      await insertReq.query(
        `INSERT INTO [CallStatus] (id, roomId, currentStatus, callType, dateTime, isMuted, mutedDateTime, dateTimeReset)
         VALUES (@id, @roomId, @currentStatus, @callType, @dateTime, @isMuted, @mutedDateTime, @dateTimeReset)`
      );
      const roomInfo = await pool.request()
        .input('id', sql.NVarChar(50), roomId)
        .query(`SELECT roomName FROM [Room] WHERE id = @id`);
      const roomName = roomInfo.recordset.length ? roomInfo.recordset[0].roomName : '';
      const newCall = withCallTypeFields(withCallStatusFields({
        id: callId,
        roomId,
        roomName,
        status: 0,
        callType: MISCELLANEOUS_CALL_TYPE,
        timestamp: now,
        minutesAgo: 0,
        muted: false,
        dateTimeReset: now,
        organisationId,
      }));
      return res.status(201).json({ success: true, data: newCall });
    }
    const currentStatus = [1, 2, 3, 4].includes(statusNumber) ? statusNumber : 1;
    const insertReq = pool.request();
    insertReq.input("id", sql.NVarChar(50), callId);
    insertReq.input("roomId", sql.NVarChar(50), roomId);
    insertReq.input("currentStatus", sql.Int, currentStatus);
    insertReq.input("callType", sql.Int, currentStatus);
    insertReq.input("dateTime", sql.DateTime, now);
    insertReq.input("isMuted", sql.Int, 0);
    insertReq.input("mutedDateTime", sql.DateTime, null);
    insertReq.input("dateTimeReset", sql.DateTime, null);
    await insertReq.query(
      `INSERT INTO [CallStatus] (id, roomId, currentStatus, callType, dateTime, isMuted, mutedDateTime, dateTimeReset)
       VALUES (@id, @roomId, @currentStatus, @callType, @dateTime, @isMuted, @mutedDateTime, @dateTimeReset)`
    );

    const hasHidColumn = await ensureRoomHidColumn(pool);
    const roomInfo = await pool.request()
      .input('id', sql.NVarChar(50), roomId)
      .query(
        `SELECT roomName, floor${hasHidColumn ? `, ${ROOM_HID_COLUMN} AS hid` : `, NULL AS hid`} FROM [Room] WHERE id = @id`
      );
    const roomRow = roomInfo.recordset[0];
    const roomName = roomRow ? roomRow.roomName : '';

    const newCall = withCallTypeFields(withCallStatusFields({
      id: callId,
      roomId,
      roomName,
      status: currentStatus,
      callType: currentStatus,
      timestamp: now,
      minutesAgo: 0,
      muted: false,
      dateTimeReset: null,
      // Lets a split dashboard place the live card in the right pane.
      hid: roomRow?.hid ?? null,
      floor: roomRow?.floor ?? null,
      organisationId
    }));

    io.to(`org_${organisationId}`).emit("call:new", newCall);
    await writeActivityLog(pool, {
      organisationId,
      action: "call.created",
      entityType: "call",
      entityId: callId,
      message: `Call created: ${roomName} (${getCallTypeName(currentStatus)})`,
      details: { roomId, status: currentStatus },
    });
    return res.status(201).json({ success: true, data: newCall });
  } catch (err) {
    console.error('[CALLS POST] Error:', err);
    return res.status(500).json({ success: false, error: 'Failed to create call' });
  }
});

// Update call status or mute in DB
app.put("/api/calls/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, muted, organisationId, manualResolve } = req.body;
  try {
    const pool = await getPool();
    // Update mute status and/or status in CallStatus table
    let updateFields = [];
    let params = [];
    if (muted !== undefined) {
      updateFields.push('[isMuted] = @isMuted');
      params.push({ name: 'isMuted', type: sql.Bit, value: muted ? 1 : 0 });
      // If muting, set mutedDateTime to now
      updateFields.push('[mutedDateTime] = @mutedDateTime');
      params.push({ name: 'mutedDateTime', type: sql.DateTime, value: muted ? new Date() : null });
    }
    if (status !== undefined) {
      updateFields.push('[currentStatus] = @currentStatus');
      params.push({ name: 'currentStatus', type: sql.Int, value: status });
      if (Number(status) === 0) {
        updateFields.push('[dateTimeReset] = @dateTimeReset');
        params.push({ name: 'dateTimeReset', type: sql.DateTime, value: new Date() });
        if (manualResolve && await hasResolvedManuallyColumn(pool)) {
          updateFields.push('[resolvedManually] = @resolvedManually');
          params.push({ name: 'resolvedManually', type: sql.Bit, value: 1 });
        }
      }
    }
    if (updateFields.length === 0) {
      return res.status(400).json({ success: false, error: 'No fields to update' });
    }
    const updateReq = pool.request();
    updateReq.input('id', sql.NVarChar(50), id);
    params.forEach(p => updateReq.input(p.name, p.type, p.value));
    const updateQuery = `UPDATE [CallStatus] SET ${updateFields.join(', ')} WHERE id = @id`;
    await updateReq.query(updateQuery);

    // Fetch updated call
    const resolvedManuallyEnabled = await hasResolvedManuallyColumn(pool);
    const result = await pool.request().input('id', sql.NVarChar(50), id).query(
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[callType], cs.[dateTime], cs.[isMuted], cs.[mutedDateTime], cs.[dateTimeReset]${
        resolvedManuallyEnabled ? `, cs.[resolvedManually]` : ``
      }, r.[roomName]
       FROM [CallStatus] cs
       LEFT JOIN [Room] r ON cs.[roomId] = r.[id]
       WHERE cs.[id] = @id`
    );
    const row = result.recordset[0];
    if (Number(status) === 0 && manualResolve) {
      await writeActivityLog(pool, {
        organisationId: String(organisationId || ""),
        action: "call.resolved.dashboard",
        entityType: "call",
        entityId: id,
        message: `Call resolved from dashboard: ${row?.roomName || id}`,
        details: { source: "dashboard" },
      });
    }
    const call = row
      ? withCallTypeFields(withCallStatusFields({
          id: row.id,
          roomId: row.roomId,
          roomName: row.roomName || '',
          status: row.currentStatus,
          callType: row.callType ?? row.currentStatus,
          timestamp: row.dateTime,
          minutesAgo: row.dateTime ? Math.floor((Date.now() - new Date(row.dateTime).getTime()) / 60000) : null,
          muted: row.isMuted === 1 || row.isMuted === true,
          mutedDateTime: row.mutedDateTime,
          dateTimeReset: row.dateTimeReset,
          resolvedManually:
            manualResolve && Number(status) === 0
              ? true
              : mapResolvedManually(row),
          organisationId
        }))
      : null;

    // Broadcast to org room
    if (muted !== undefined) {
      console.log(`[SOCKET] Emitting 'call:muted' to org_${organisationId} | id: ${id} | muted: ${muted}`);
      io.to(`org_${organisationId}`).emit("call:muted", { id, muted });
    }
    if (status !== undefined) io.to(`org_${organisationId}`).emit("call:status", { id, status });
    res.status(200).json({ success: true, data: call });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to update call' });
  }
});
// Get all call history for report
app.get("/api/calls/history", async (req: Request, res: Response) => {
  try {
    const { startDate, endDate, resetStartDate, resetEndDate, search, status, room, muted, organisationId, hid, floor, page = 1, pageSize = 10 } = req.query;
    if (!organisationId) {
      return res.status(400).json({ success: false, error: "organisationId is required" });
    }
    const pool = await getPool();
    const repeatEnabled = await hasCallRepeatTable(pool);
    const activityLogEnabled = await hasActivityLogTable(pool);
    const resolvedManuallyEnabled = await hasResolvedManuallyColumn(pool);
    // Reports scope by device or by floor, so both travel with every row and
    // are filtered in SQL - narrowing after pagination would drop rows.
    const hasHidColumn = await ensureRoomHidColumn(pool);
    let query =
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[callType], cs.[dateTime], cs.[isMuted], cs.[mutedDateTime], cs.[dateTimeReset], r.[roomName], r.[departmentType], r.[roomType], r.[floor]${
        hasHidColumn ? `, r.[${ROOM_HID_COLUMN}] AS [hid]` : `, NULL AS [hid]`
      }${
        resolvedManuallyEnabled ? `, cs.[resolvedManually] AS [resolvedManually]` : `, NULL AS [resolvedManually]`
      }${
        repeatEnabled
          ? `, ISNULL(cr.[repeatCount], 0) AS [repeatCount], cr.[lastRepeatAt] AS [lastRepeatAt]`
          : `, 0 AS [repeatCount], NULL AS [lastRepeatAt]`
      }${
        activityLogEnabled
          ? `, resolveLog.[action] AS resolveAction`
          : `, NULL AS resolveAction`
      }
       FROM [CallStatus] cs
       LEFT JOIN [Room] r ON cs.[roomId] = r.[id]
       ${
         repeatEnabled
           ? `LEFT JOIN (
                SELECT callId, COUNT(*) AS repeatCount, MAX(repeatAt) AS lastRepeatAt
                FROM [CallRepeat]
                GROUP BY callId
              ) cr ON cr.callId = cs.[id]`
           : ``
       }${
         activityLogEnabled
           ? ` LEFT JOIN (
                SELECT al.entityId, al.action
                FROM [ActivityLog] al
                INNER JOIN (
                  SELECT entityId, MAX(createdAt) AS maxCreatedAt
                  FROM [ActivityLog]
                  WHERE entityType = N'call' AND action IN (N'call.resolved', N'call.resolved.dashboard', N'call.resolved.beacon')
                  GROUP BY entityId
                ) latest ON al.entityId = latest.entityId AND al.createdAt = latest.maxCreatedAt
                WHERE al.entityType = N'call' AND al.action IN (N'call.resolved', N'call.resolved.dashboard', N'call.resolved.beacon')
              ) resolveLog ON resolveLog.entityId = cs.[id]`
           : ``
       }`;
    const where: string[] = [];
    const params: any[] = [];
    if (startDate) {
      where.push('cs.[dateTime] >= @startDate');
      params.push({ name: 'startDate', type: sql.DateTime, value: new Date(startDate as string) });
    }
    if (endDate) {
      where.push('cs.[dateTime] <= @endDate');
      params.push({ name: 'endDate', type: sql.DateTime, value: new Date(endDate as string) });
    }
    if (resetStartDate) {
      where.push('cs.[dateTimeReset] >= @resetStartDate');
      params.push({ name: 'resetStartDate', type: sql.DateTime, value: new Date(resetStartDate as string) });
    }
    if (resetEndDate) {
      where.push('cs.[dateTimeReset] <= @resetEndDate');
      params.push({ name: 'resetEndDate', type: sql.DateTime, value: new Date(resetEndDate as string) });
    }
    if (search) {
      where.push('(r.[roomName] LIKE @search OR cs.[id] LIKE @search)');
      params.push({ name: 'search', type: sql.NVarChar, value: `%${search}%` });
    }
    if (status) {
      const statusStr = String(status).toLowerCase();
      if (statusStr === "active") {
        where.push("cs.[currentStatus] <> 0 AND cs.[dateTimeReset] IS NULL");
      } else if (statusStr === "resolved" || statusStr === "0") {
        where.push("(cs.[currentStatus] = 0 OR cs.[dateTimeReset] IS NOT NULL)");
      } else {
        where.push("cs.[currentStatus] = @status");
        params.push({ name: "status", type: sql.Int, value: Number(status) });
      }
    }
    if (room) {
      where.push('cs.[roomId] = @room');
      params.push({ name: 'room', type: sql.NVarChar, value: room });
    }
    if (muted) {
      where.push('cs.[isMuted] = @muted');
      params.push({ name: 'muted', type: sql.Bit, value: muted === 'true' ? 1 : 0 });
    }
    if (hid && hasHidColumn) {
      where.push(`r.[${ROOM_HID_COLUMN}] = @hid`);
      params.push({ name: 'hid', type: sql.NVarChar(20), value: String(hid) });
    }
    if (floor !== undefined && floor !== "") {
      where.push('r.[floor] = @floor');
      params.push({ name: 'floor', type: sql.Int, value: Number(floor) });
    }
    where.push('r.[organisationId] = @organisationId');
    params.push({ name: 'organisationId', type: sql.NVarChar(50), value: String(organisationId) });
    if (where.length > 0) {
      query += ' WHERE ' + where.join(' AND ');
    }
    query += repeatEnabled
      ? ` ORDER BY (SELECT MAX(dt) FROM (VALUES (cs.[dateTime]), (cs.[dateTimeReset]), (cr.[lastRepeatAt])) AS T(dt)) DESC, cs.[dateTime] DESC`
      : ` ORDER BY (SELECT MAX(dt) FROM (VALUES (cs.[dateTime]), (cs.[dateTimeReset])) AS T(dt)) DESC, cs.[dateTime] DESC`;
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM [CallStatus] cs LEFT JOIN [Room] r ON cs.[roomId] = r.[id]';
    if (where.length > 0) {
      countQuery += ' WHERE ' + where.join(' AND ');
    }
    const countReq = pool.request();
    const dataReq = pool.request();
    params.forEach(p => {
      countReq.input(p.name, p.type, p.value);
      dataReq.input(p.name, p.type, p.value);
    });
    const paginatedQuery = `${query} OFFSET ${(Number(page) - 1) * Number(pageSize)} ROWS FETCH NEXT ${Number(pageSize)} ROWS ONLY`;
    const [countResult, result] = await Promise.all([
      countReq.query(countQuery),
      dataReq.query(paginatedQuery),
    ]);
    const totalCount = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / Number(pageSize));
    const calls = result.recordset.map((row: any) =>
      withCallTypeFields(withCallStatusFields({
        id: row.id,
        roomId: row.roomId,
        roomName: row.roomName || '',
        status: row.currentStatus,
        isActive: isCallRecordActive(row),
        callType: row.callType ?? (row.currentStatus >= 1 && row.currentStatus <= 4 ? row.currentStatus : null),
        timestamp: row.dateTime,
        muted: row.isMuted === 1 || row.isMuted === true,
        mutedDateTime: row.mutedDateTime,
        dateTimeReset: row.dateTimeReset,
        resolvedManually: mapResolvedManually(row),
        resolvedBy: mapResolveSource(row),
        departmentType: row.departmentType,
        roomType: row.roomType,
        floor: row.floor,
        hid: row.hid ?? null,
        repeatCount: row.repeatCount || 0,
        lastRepeatAt: row.lastRepeatAt,
        repeatDurationMinutes:
          row.lastRepeatAt && row.dateTime
            ? Math.max(0, Math.floor((new Date(row.lastRepeatAt).getTime() - new Date(row.dateTime).getTime()) / 60000))
            : null,
      }))
    );
    res.status(200).json({
      success: true,
      data: calls,
      totalPages,
      totalCount,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  } catch (err) {
    console.error('[CALLS HISTORY] Error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch call history' });
  }
});
// Parse r{roomNo}=status from query (e.g. r01=1&r02=2&r22=3). Room keys are 2-digit zero-padded.
// Status: 0=reset, 1=normal, 2=emergency, 3=code blue, 4=toilet
function parseRoomStatusParams(query: Request["query"]): { roomNo: string; status: number }[] {
  const rooms: { roomNo: string; status: number }[] = [];
  for (const key of Object.keys(query)) {
    const match = /^r(\d+)$/i.exec(key);
    if (!match) continue;
    const raw = query[key];
    const statusVal = Array.isArray(raw) ? raw[0] : raw;
    if (statusVal === undefined || statusVal === "") continue;
    // r01/r02 in URL map to roomNo_deviceNo 1/2 in the database
    rooms.push({ roomNo: String(parseInt(match[1], 10)), status: Number(statusVal) });
  }
  return rooms;
}

async function insertMiscellaneousCall(
  pool: Awaited<ReturnType<typeof getPool>>,
  roomId: string,
  dnum: string
): Promise<{ httpStatus: number; result: string; message: string }> {
  const callId = `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const now = new Date();
  const insertReq = pool.request();
  insertReq.input("id", sql.NVarChar(50), callId);
  insertReq.input("roomId", sql.NVarChar(50), roomId);
  insertReq.input("currentStatus", sql.Int, 0);
  insertReq.input("callType", sql.Int, MISCELLANEOUS_CALL_TYPE);
  insertReq.input("dateTime", sql.DateTime, now);
  insertReq.input("isMuted", sql.Int, 0);
  insertReq.input("mutedDateTime", sql.DateTime, null);
  insertReq.input("dateTimeReset", sql.DateTime, now);
  await insertReq.query(
    `INSERT INTO [CallStatus] (id, roomId, currentStatus, callType, dateTime, isMuted, mutedDateTime, dateTimeReset)
     VALUES (@id, @roomId, @currentStatus, @callType, @dateTime, @isMuted, @mutedDateTime, @dateTimeReset)`
  );
  return {
    httpStatus: 200,
    result: "SUCCESS",
    message: `Room ${dnum}: miscellaneous call logged (reports only)`,
  };
}

async function processCallStatusForRoom(
  pool: Awaited<ReturnType<typeof getPool>>,
  orgId: string,
  hid: string,
  dnum: string,
  statusNumber: number,
  repeatEnabled: boolean
): Promise<{ httpStatus: number; result: string; message?: string; error?: string }> {
  const isReset = statusNumber === 0;
  const isMiscellaneous = statusNumber === MISCELLANEOUS_CALL_TYPE;
  const isActivate = !Number.isNaN(statusNumber) && statusNumber !== 0 && !isMiscellaneous;

  // Organisation + HID + device number identifies the room. The room tagged
  // with the reporting device wins; rooms with no HID stay reachable so sites
  // that never filled the field in keep working, while a room belonging to
  // another device is never picked up by this one. Floor is not consulted: two
  // devices may well cover the same floor, and one device may span several.
  const hasHidColumn = await ensureRoomHidColumn(pool);
  const roomRequest = pool.request()
    .input('organisationId', sql.NVarChar(50), String(orgId))
    .input('roomNo_deviceNo', sql.NVarChar(100), dnum);
  if (hasHidColumn) roomRequest.input('hid', sql.NVarChar(20), hid);
  const roomResult = await roomRequest.query(
    `SELECT TOP 1 id, roomName, floor FROM [${ROOM_TABLE}]
      WHERE organisationId = @organisationId
        AND roomNo_deviceNo = @roomNo_deviceNo
        AND active = 1
        ${hasHidColumn ? `AND (${ROOM_HID_COLUMN} = @hid OR ${ROOM_HID_COLUMN} IS NULL)` : ""}
      ORDER BY ${hasHidColumn ? `CASE WHEN ${ROOM_HID_COLUMN} = @hid THEN 0 ELSE 1 END, ` : ""}id`
  );
  if (!roomResult.recordset.length) {
    return {
      httpStatus: 404,
      result: "FAILURE",
      error: `Room not found for device number ${dnum} on hid ${hid}`,
    };
  }
  const roomId = roomResult.recordset[0].id;
  // Fetched with the id above so the emit paths below need no extra round trip.
  const roomName: string = roomResult.recordset[0].roomName || '';
  // Carried into the call:new payloads so a split dashboard can route the live
  // event to the pane watching this device or floor without re-fetching.
  const roomFloor: number | null = roomResult.recordset[0].floor ?? null;

  if (isMiscellaneous) {
    return insertMiscellaneousCall(pool, roomId, dnum);
  }

  const activeCallResult = await pool.request()
    .input('roomId', sql.NVarChar(50), roomId)
    .query(`SELECT TOP 1 id, currentStatus, callType, dateTime, isMuted, dateTimeReset FROM [CallStatus] WHERE roomId = @roomId AND currentStatus <> 0 ORDER BY dateTime DESC`);
  if (activeCallResult.recordset.length > 0 && isActivate) {
    const existing = activeCallResult.recordset[0];

    if (repeatEnabled) {
      try {
        await pool.request()
          .input('callId', sql.NVarChar(50), existing.id)
          .input('roomId', sql.NVarChar(50), roomId)
          .input('organisationId', sql.NVarChar(50), String(orgId))
          .input('repeatAt', sql.DateTime, new Date())
          .query(`INSERT INTO [CallRepeat] (callId, roomId, organisationId, repeatAt) VALUES (@callId, @roomId, @organisationId, @repeatAt)`);
      } catch (repeatErr) {
        console.error('[CALLSTATUS INSERT] Failed to log repeat:', repeatErr);
      }
    }

    io.to(`org_${orgId}`).emit("call:new", withCallTypeFields(withCallStatusFields({
      id: existing.id,
      roomId,
      roomName,
      status: existing.currentStatus,
      callType: existing.callType ?? existing.currentStatus,
      timestamp: existing.dateTime || new Date(),
      muted: existing.isMuted === 1 || existing.isMuted === true,
      dateTimeReset: existing.dateTimeReset,
      minutesAgo: 0,
      hid,
      floor: roomFloor,
      organisationId: orgId,
    })));

    await writeActivityLog(pool, {
      organisationId: orgId,
      action: "call.repeated",
      entityType: "call",
      entityId: existing.id,
      message: `Repeated call: ${roomName}`,
      details: { roomId, dnum, hid, floor: roomFloor },
    });

    return {
      httpStatus: 200,
      result: "SUCCESS",
      message: `Room ${dnum}: repeated call - announcement broadcast (call record unchanged)`,
    };
  }
  if (activeCallResult.recordset.length === 0 && isReset) {
    // Reset should not create a new call if none is active.
    return { httpStatus: 200, result: "SUCCESS", message: `Room ${dnum}: reset ignored (no active call)` };
  }
  if (activeCallResult.recordset.length > 0 && isReset) {
    const callId = activeCallResult.recordset[0].id;
    const resolvedManuallyEnabled = await hasResolvedManuallyColumn(pool);
    const resetReq = pool.request()
      .input('id', sql.NVarChar(50), callId)
      .input('currentStatus', sql.Int, 0)
      .input('dateTimeReset', sql.DateTime, new Date());
    if (resolvedManuallyEnabled) resetReq.input('resolvedManually', sql.Bit, 0);
    await resetReq.query(
      resolvedManuallyEnabled
        ? `UPDATE [CallStatus] SET currentStatus = @currentStatus, dateTimeReset = @dateTimeReset, resolvedManually = @resolvedManually WHERE id = @id`
        : `UPDATE [CallStatus] SET currentStatus = @currentStatus, dateTimeReset = @dateTimeReset WHERE id = @id`
    );
    io.to(`org_${orgId}`).emit("call:status", { id: callId, status: 0 });
    await writeActivityLog(pool, {
      organisationId: orgId,
      action: "call.resolved",
      entityType: "call",
      entityId: callId,
      message: `Call resolved: room ${dnum} (hid ${hid})`,
      details: { roomId, dnum, hid, floor: roomFloor },
    });
    return { httpStatus: 200, result: "SUCCESS", message: `Room ${dnum}: call status reset` };
  }
  if (!isActivate && !isReset) {
    return { httpStatus: 400, result: "FAILURE", error: `Room ${dnum}: invalid status (use 0=reset, 1=normal, 2=emergency, 3=code blue, 4=toilet, 5=miscellaneous)` };
  }
  const callId = `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  const insertReq = pool.request();
  insertReq.input("id", sql.NVarChar(50), callId);
  insertReq.input("roomId", sql.NVarChar(50), roomId);
  insertReq.input("currentStatus", sql.Int, statusNumber);
  insertReq.input("callType", sql.Int, statusNumber);
  const now = new Date();
  insertReq.input("dateTime", sql.DateTime, now);
  insertReq.input("isMuted", sql.Int, 0);
  insertReq.input("mutedDateTime", sql.DateTime, null);
  if (isActivate) { insertReq.input("dateTimeReset", sql.DateTime, null); }
  else { insertReq.input("dateTimeReset", sql.DateTime, now); }
  const insertQuery = `INSERT INTO [CallStatus] (id, roomId, currentStatus, callType, dateTime, isMuted, mutedDateTime, dateTimeReset) VALUES (@id, @roomId, @currentStatus, @callType, @dateTime, @isMuted, @mutedDateTime, @dateTimeReset)`;
  await insertReq.query(insertQuery);
  io.to(`org_${orgId}`).emit("call:new", withCallTypeFields(withCallStatusFields({
    id: callId,
    roomId,
    roomName,
    status: statusNumber,
    callType: statusNumber,
    timestamp: now,
    muted: false,
    dateTimeReset: isActivate ? null : now,
    minutesAgo: 0,
    hid,
    floor: roomFloor,
    organisationId: orgId,
  })));
  await writeActivityLog(pool, {
    organisationId: orgId,
    action: "call.created",
    entityType: "call",
    entityId: callId,
    message: `Device call: ${roomName} - ${getCallTypeName(statusNumber)}`,
    details: { roomId, dnum, hid, floor: roomFloor, status: statusNumber },
  });
  return { httpStatus: 200, result: "SUCCESS", message: `Room ${dnum}: new call inserted (status ${statusNumber})` };
}

// ---------------------------------------------------------------------------
// Beacon reconciliation
//
// A beacon URL is the device's periodic snapshot of what is still ringing on
// its own panel:
//
//   /api/callstatus/insert?orgId=00003&hid=2408202601&beacon&r01=1&r03=3
//
// Only what the device still holds active is listed. A room it has already
// cleared is sent as 0 (r02=0) or simply left out, and a beacon carrying no
// r-params at all means the panel is completely clear. Dashboard calls stay
// open until something resets them, so a call the device dropped without the
// reset landing here would sit active forever - the beacon closes that gap:
// every call open for this device that the beacon does not list as active is
// resolved below and disappears from the dashboard live.
//
// A beacon never opens a call. It repeats state the insert URL already
// delivered when the call was raised, so treating it as a call would log a
// repeat and re-announce every listed room on every beacon tick.
const BEACON_PARAM = "beacon";

function hasBeaconFlag(query: Request["query"]): boolean {
  return Object.keys(query).some((key) => key.toLowerCase() === BEACON_PARAM);
}

// r01 arrives here as "1" while the room column may hold "01", "1" or "Room 1":
// compare on the digits so a device number matches however it was typed in.
function normalizeDeviceNo(value: unknown): string {
  const raw = String(value ?? "").trim();
  const digits = raw.replace(/D/g, "");
  return digits ? String(parseInt(digits, 10)) : raw;
}

async function processBeaconSnapshot(
  pool: Awaited<ReturnType<typeof getPool>>,
  orgId: string,
  hid: string,
  roomUpdates: { roomNo: string; status: number }[]
): Promise<{ httpStatus: number; result: string; message: string }> {
  const stillRinging = new Set(
    roomUpdates.filter((r) => r.status !== 0).map((r) => normalizeDeviceNo(r.roomNo))
  );

  // Same room-matching rule as a call insert - rooms tagged with this device
  // plus rooms with no HID filled in - so a beacon closes exactly the calls
  // this device is able to open, and never another device's.
  const hasHidColumn = await ensureRoomHidColumn(pool);
  const openReq = pool.request().input("organisationId", sql.NVarChar(50), orgId);
  if (hasHidColumn) openReq.input("hid", sql.NVarChar(20), hid);
  const openCalls = await openReq.query(
    `SELECT cs.[id], cs.[roomId], r.[roomNo_deviceNo] AS deviceNo, r.[roomName], r.[floor]
       FROM [CallStatus] cs
       INNER JOIN [${ROOM_TABLE}] r ON cs.[roomId] = r.[id]
      WHERE cs.[currentStatus] <> 0
        AND ISNULL(cs.[callType], cs.[currentStatus]) <> ${MISCELLANEOUS_CALL_TYPE}
        AND r.[organisationId] = @organisationId
        AND r.[active] = 1
        ${hasHidColumn ? `AND (r.[${ROOM_HID_COLUMN}] = @hid OR r.[${ROOM_HID_COLUMN}] IS NULL)` : ""}`
  );

  const cleared = openCalls.recordset.filter(
    (row: any) => !stillRinging.has(normalizeDeviceNo(row.deviceNo))
  );
  if (cleared.length === 0) {
    return {
      httpStatus: 200,
      result: "SUCCESS",
      message: `Beacon ${hid}: nothing to resolve (${stillRinging.size} call(s) still active on the device)`,
    };
  }

  const resolvedManuallyEnabled = await hasResolvedManuallyColumn(pool);
  for (const row of cleared) {
    const resetReq = pool.request()
      .input("id", sql.NVarChar(50), row.id)
      .input("dateTimeReset", sql.DateTime, new Date());
    // Cleared at the device, not by a nurse on the dashboard.
    if (resolvedManuallyEnabled) resetReq.input("resolvedManually", sql.Bit, 0);
    await resetReq.query(
      resolvedManuallyEnabled
        ? `UPDATE [CallStatus] SET currentStatus = 0, dateTimeReset = @dateTimeReset, resolvedManually = @resolvedManually WHERE id = @id`
        : `UPDATE [CallStatus] SET currentStatus = 0, dateTimeReset = @dateTimeReset WHERE id = @id`
    );
    io.to(`org_${orgId}`).emit("call:status", { id: row.id, status: 0 });
    await writeActivityLog(pool, {
      organisationId: orgId,
      action: BEACON_RESOLVE_ACTION,
      entityType: "call",
      entityId: row.id,
      message: `Call resolved by beacon: ${row.roomName || row.deviceNo} (hid ${hid})`,
      details: {
        roomId: row.roomId,
        dnum: normalizeDeviceNo(row.deviceNo),
        hid,
        floor: row.floor ?? null,
        source: "beacon",
      },
    });
  }

  return {
    httpStatus: 200,
    result: "SUCCESS",
    message: `Beacon ${hid}: resolved ${cleared.length} call(s) already cleared on the device`,
  };
}

// Call status API contract (device integration)
app.get("/api/callstatus", (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.status(200).json({
    insertEndpoint: `${base}/api/callstatus/insert`,
    method: "GET",
    example: `${base}/api/callstatus/insert?orgId=00001&hid=1234567890&r01=1&r02=2&r22=3`,
    queryParams: {
      orgId: "required - organisation id",
      hid: "required - 10-digit hardware id; identifies the room together with orgId and the device number",
      "r{roomNo}": "required (one or more) - 2-digit zero-padded room device number with status value (e.g. r01, r02, r22)",
      beacon: "optional flag (no value) - marks the request as a device snapshot instead of a call; see beaconNote",
    },
    beaconNote:
      "With ?...&beacon& the r-params are the rooms still ringing on the device, not new calls. " +
      "Any call open on the dashboard for this hid that the beacon does not list as active - sent as 0, or left out entirely - is resolved. " +
      "A beacon with no r-params at all means every room on the device is clear and resolves all of its open calls. A beacon never creates a call.",
    beaconExample: `${base}/api/callstatus/insert?orgId=00001&hid=1234567890&beacon&r01=1&r03=3`,
    // The device does not send a floor. The server reads it off the matched
    // room and returns it on the call, so a room can be moved between floors in
    // the settings page without reprogramming the hardware.
    floorNote: "not a query parameter - resolved from the room and returned on the call",
    statusCodes: CALL_STATUS_MAP,
  });
});

// Insert record into CallStatus via GET (for device integration)
// URL: /api/callstatus/insert?orgId=00001&hid=1234567890&r01=1&r02=2&r22=3
// Add &beacon& to send a device snapshot instead of a call - see processBeaconSnapshot above.
// r{roomNo}=0 reset | 1 normal | 2 emergency | 3 code blue | 4 toilet | 5 miscellaneous (reports only)
// The room is identified by orgId + hid + device number. The device sends no
// floor: it is read off the matched room below and travels back with the call,
// so moving a room to another floor is a settings-page edit, not a device
// reprogramming. A `floor` left over in an old device's URL is ignored.
app.get("/api/callstatus/insert", async (req: Request, res: Response) => {
  const sendCallStatusResult = (httpStatus: number, ok: boolean) =>
    res.status(httpStatus).type("text/plain").send(ok ? "SUCCESS" : "FAILURE");

  const { orgId, hid, dnum, status } = req.query;
  if (!orgId || !hid) {
    return sendCallStatusResult(400, false);
  }
  const hidStr = String(Array.isArray(hid) ? hid[0] : hid);
  if (!HID_PATTERN.test(hidStr)) {
    return sendCallStatusResult(400, false);
  }

  // A beacon is a snapshot, not a call: an empty one ("...&beacon&") is the
  // device saying every room is clear, so it must not fall through to the
  // dnum/status form below and be rejected as an empty request.
  const isBeacon = hasBeaconFlag(req.query);

  let roomUpdates = parseRoomStatusParams(req.query);
  if (roomUpdates.length === 0 && !isBeacon) {
    if (!dnum || status === undefined) {
      return sendCallStatusResult(400, false);
    }
    roomUpdates = [{ roomNo: String(dnum), status: Number(status) }];
  }

  for (const { status: statusNumber } of roomUpdates) {
    if (!isValidCallStatus(statusNumber)) {
      return sendCallStatusResult(400, false);
    }
  }

  try {
    const pool = await getPool();

    if (isBeacon) {
      const outcome = await processBeaconSnapshot(pool, String(orgId), hidStr, roomUpdates);
      console.log('[CALLSTATUS BEACON]', outcome.message);
      return sendCallStatusResult(outcome.httpStatus, outcome.result === "SUCCESS");
    }

    const repeatEnabled = await hasCallRepeatTable(pool);
    let worstStatus = 200;
    let allSuccess = true;

    for (const { roomNo, status: statusNumber } of roomUpdates) {
      const outcome = await processCallStatusForRoom(
        pool,
        String(orgId),
        hidStr,
        roomNo,
        statusNumber,
        repeatEnabled
      );
      if (outcome.result !== "SUCCESS") allSuccess = false;
      if (outcome.httpStatus > worstStatus) worstStatus = outcome.httpStatus;
    }

    const httpStatus = allSuccess ? 200 : worstStatus > 200 ? worstStatus : 400;
    return sendCallStatusResult(httpStatus, allSuccess);
  } catch (err) {
    console.error('[CALLSTATUS INSERT] Error:', err);
    return sendCallStatusResult(500, false);
  }
});
// Health check
app.get("/api/health", (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
    uptimeSeconds: Math.round(process.uptime()),
    dbPool: getPoolStats(),
  });
});

// Test DB connectivity
app.get('/api/test-db', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const table = process.env.USER_TABLE || 'User';

    // Try a simple query against the user table
    try {
      // Bracketed: the default table name is "User", a reserved word.
      const r = await pool.request().query(`SELECT TOP 1 * FROM [${table}]`);
      return res.status(200).json({ success: true, message: 'DB connected', rows: r.recordset.length, sample: r.recordset[0] || null });
    } catch (innerErr) {
      // If the table doesn't exist or query fails, try a generic select 1
      try {
        const r2 = await pool.request().query('SELECT 1 AS ok');
        return res.status(200).json({ success: true, message: 'DB connected (fallback query)', sample: r2.recordset[0] });
      } catch (innerErr2) {
        console.error('DB fallback query failed', innerErr2);
        return res.status(500).json({ success: false, error: String(innerErr2) });
      }
    }
  } catch (err) {
    console.error('DB connection error', err);
    return res.status(500).json({ success: false, error: String(err) });
  }
});

// Start server
server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // Warm the pool so the first device call is not paying connect latency and
  // /api/health reports real pool state from the start. A failure here is not
  // fatal - getPool() retries on the next request.
  getPool()
    .then(() => console.log("DB pool warmed up"))
    .catch((err) => console.error("DB pool warm-up failed (will retry on demand):", err.message));
});

// Graceful shutdown: close the SQL pool so SQL Server drops our sessions right
// away. Killing the process without this leaves up to pool.max sessions open on
// the server until they time out, and they accumulate across restarts.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  io.close();
  server.close();
  await closePool();
  process.exit(0);
}

// NOTE (Windows): only SIGINT (Ctrl+C) and SIGBREAK are delivered to Node here.
// A `taskkill` or Windows service stop terminates the process without running
// these handlers, so the pool is not closed cleanly in that case - stop the
// service with Ctrl+C, or with a signal-forwarding wrapper (pm2/nssm), if you
// want SQL Server to drop the sessions immediately.
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});
