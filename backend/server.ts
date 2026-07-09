
import express, { Express, Request, Response, NextFunction } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getPool, sql } from "./db";
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

async function getOrganisationName(pool: Awaited<ReturnType<typeof getPool>>, orgId?: string | null) {
  if (!orgId) return null;
  try {
    const r = await pool.request()
      .input("id", sql.NVarChar(50), orgId)
      .query(`SELECT name FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    return r.recordset[0]?.name || orgId;
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

// Super admin — organisations & users
app.get("/api/admin/organisations", requireSuperAdmin, async (_req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(
      `SELECT id, name, address, phoneNo, contactPerson, hid FROM [${ORGANISATION_TABLE}] ORDER BY id`
    );
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (err) {
    console.error("[ADMIN ORGANISATIONS GET] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch organisations" });
  }
});

app.post("/api/admin/organisations", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id, name, address, phoneNo, contactPerson, hid } = req.body;
    if (!id || !name) {
      return res.status(400).json({ success: false, error: "id and name are required" });
    }
    const hidStr = hid ? String(hid) : null;
    if (hidStr && !/^\d{10}$/.test(hidStr)) {
      return res.status(400).json({ success: false, error: "hid must be a 10-digit number" });
    }
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    if (exists.recordset.length > 0) {
      return res.status(409).json({ success: false, error: "Organisation with this id already exists" });
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
    await writeActivityLog(pool, {
      organisationId: id,
      organisationName: name,
      action: "organisation.created",
      entityType: "organisation",
      entityId: id,
      message: `Organisation created: ${name}`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
    });
    return res.status(201).json({
      success: true,
      data: { id, name, address: address || null, phoneNo: phoneNo || null, contactPerson: contactPerson || null, hid: hidStr },
    });
  } catch (err) {
    console.error("[ADMIN ORGANISATIONS POST] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to create organisation" });
  }
});

app.put("/api/admin/organisations/:id", requireSuperAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, address, phoneNo, contactPerson, hid } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, error: "name is required" });
    }
    const hidStr = hid ? String(hid) : null;
    if (hidStr && !/^\d{10}$/.test(hidStr)) {
      return res.status(400).json({ success: false, error: "hid must be a 10-digit number" });
    }
    const pool = await getPool();
    const exists = await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`SELECT id FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
    if (!exists.recordset.length) {
      return res.status(404).json({ success: false, error: "Organisation not found" });
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
    await writeActivityLog(pool, {
      organisationId: id,
      organisationName: name,
      action: "organisation.updated",
      entityType: "organisation",
      entityId: id,
      message: `Organisation updated: ${name}`,
      actorId: req.authUser?.id,
      actorName: "Super Admin",
    });
    return res.status(200).json({
      success: true,
      data: { id, name, address: address || null, phoneNo: phoneNo || null, contactPerson: contactPerson || null, hid: hidStr },
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
    await pool.request()
      .input("id", sql.NVarChar(50), id)
      .query(`DELETE FROM [${ORGANISATION_TABLE}] WHERE id = @id`);
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

// Super admin — activity log (all organisations)
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
    return res.status(200).json({ success: true, data: result.recordset[0] });
  } catch (err) {
    console.error("[ORGANISATIONS GET/:id] Error:", err);
    return res.status(500).json({ success: false, error: "Failed to fetch organisation" });
  }
});

// Room Management Routes (MSSQL-backed)
const ROOM_TABLE = 'Room';

// GET all rooms
app.get("/api/rooms", async (req: Request, res: Response) => {
  try {
    const { organisationId } = req.query;
    const pool = await getPool();
    const request = pool.request();
    let query = `SELECT * FROM [${ROOM_TABLE}] WHERE active = 1`;
    if (organisationId) {
      request.input('organisationId', sql.NVarChar(50), String(organisationId));
      query += ` AND organisationId = @organisationId`;
    }
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

    const pool = await getPool();
    
    // Generate unique room ID: ROOM_{timestamp}_{random}
    const roomId = `ROOM_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const insertReq = pool.request();
    insertReq.input('id', sql.NVarChar(50), roomId);
    insertReq.input('organisationId', sql.NVarChar(50), organisationId);
    insertReq.input('roomName', sql.NVarChar(200), roomName);
    insertReq.input('roomNo_deviceNo', sql.NVarChar(100), roomNo_deviceNo || null);
    insertReq.input('roomType', sql.Int, roomType);
    insertReq.input('departmentType', sql.Int, departmentType);
    insertReq.input('floor', sql.Int, floor !== undefined ? floor : 0);
    insertReq.input('active', sql.Bit, 1);

    const insertQuery = `INSERT INTO [${ROOM_TABLE}] (id, organisationId, roomName, roomNo_deviceNo, roomType, departmentType, floor, active) 
               VALUES (@id, @organisationId, @roomName, @roomNo_deviceNo, @roomType, @departmentType, @floor, @active)`;
    
    console.log('[ROOMS POST] Executing query:', insertQuery);
    await insertReq.query(insertQuery);

    console.log('[ROOMS POST] Room created with ID:', roomId);

    await writeActivityLog(pool, {
      organisationId,
      action: "room.created",
      entityType: "room",
      entityId: roomId,
      message: `Room created: ${roomName}`,
      details: { roomNo_deviceNo, floor, roomType, departmentType },
    });

    return res.status(201).json({
      success: true,
      data: { id: roomId, organisationId, roomName, roomNo_deviceNo, roomType, departmentType, active: 1 },
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

    const pool = await getPool();
    
    // Check if room exists
    const checkReq = pool.request();
    checkReq.input('id', sql.NVarChar(50), id);
    const existsResult = await checkReq.query(`SELECT id FROM [${ROOM_TABLE}] WHERE id = @id`);
    
    if (existsResult.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    const updateReq = pool.request();
    updateReq.input('id', sql.NVarChar(50), id);
    updateReq.input('organisationId', sql.NVarChar(50), organisationId);
    updateReq.input('roomName', sql.NVarChar(200), roomName);
    updateReq.input('roomNo_deviceNo', sql.NVarChar(100), roomNo_deviceNo || null);
    updateReq.input('roomType', sql.Int, roomType);
    updateReq.input('departmentType', sql.Int, departmentType);
    updateReq.input('floor', sql.Int, floor !== undefined && floor !== null ? floor : null);
    updateReq.input('active', sql.Bit, active !== undefined ? active : 1);

    const updateQuery = `UPDATE [${ROOM_TABLE}] 
               SET organisationId = @organisationId, roomName = @roomName, roomNo_deviceNo = @roomNo_deviceNo, 
                 roomType = @roomType, departmentType = @departmentType, floor = @floor, active = @active 
               WHERE id = @id`;
    
    await updateReq.query(updateQuery);

    await writeActivityLog(pool, {
      organisationId,
      action: "room.updated",
      entityType: "room",
      entityId: id,
      message: `Room updated: ${roomName}`,
      details: { roomNo_deviceNo, floor, roomType, departmentType },
    });

    return res.status(200).json({
      success: true,
      data: { id, organisationId, roomName, roomNo_deviceNo, roomType, departmentType, active },
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
    const { organisationId } = req.query;
    console.log('[CALLS ACTIVE] Fetching active calls from DB with room name join', { organisationId });
    const pool = await getPool();
    const request = pool.request();
    let query =
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[callType], cs.[dateTime], cs.[isMuted], cs.[dateTimeReset], r.[roomName]
       FROM [CallStatus] cs
       LEFT JOIN [Room] r ON cs.[roomId] = r.[id]
       WHERE cs.[currentStatus] <> 0 AND ISNULL(cs.[callType], cs.[currentStatus]) <> ${MISCELLANEOUS_CALL_TYPE}`;
    if (organisationId) {
      request.input('organisationId', sql.NVarChar(50), String(organisationId));
      query += ` AND r.[organisationId] = @organisationId`;
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

    const roomInfo = await pool.request()
      .input('id', sql.NVarChar(50), roomId)
      .query(`SELECT roomName FROM [Room] WHERE id = @id`);
    const roomName = roomInfo.recordset.length ? roomInfo.recordset[0].roomName : '';

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
  const { status, muted, organisationId } = req.body;
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
    const result = await pool.request().input('id', sql.NVarChar(50), id).query(
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[callType], cs.[dateTime], cs.[isMuted], cs.[mutedDateTime], cs.[dateTimeReset], r.[roomName]
       FROM [CallStatus] cs
       LEFT JOIN [Room] r ON cs.[roomId] = r.[id]
       WHERE cs.[id] = @id`
    );
    const row = result.recordset[0];
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
    const { startDate, endDate, search, status, room, muted, organisationId, page = 1, pageSize = 10 } = req.query;
    const pool = await getPool();
    const repeatEnabled = await hasCallRepeatTable(pool);
    let query =
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[callType], cs.[dateTime], cs.[isMuted], cs.[mutedDateTime], cs.[dateTimeReset], r.[roomName], r.[departmentType], r.[roomType], r.[floor]${
        repeatEnabled
          ? `, ISNULL(cr.[repeatCount], 0) AS [repeatCount], cr.[lastRepeatAt] AS [lastRepeatAt]`
          : `, 0 AS [repeatCount], NULL AS [lastRepeatAt]`
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
    if (organisationId) {
      where.push('r.[organisationId] = @organisationId');
      params.push({ name: 'organisationId', type: sql.NVarChar(50), value: String(organisationId) });
    }
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
        departmentType: row.departmentType,
        roomType: row.roomType,
        floor: row.floor,
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
  floor: string,
  dnum: string,
  statusNumber: number,
  repeatEnabled: boolean
): Promise<{ httpStatus: number; result: string; message?: string; error?: string }> {
  const isReset = statusNumber === 0;
  const isMiscellaneous = statusNumber === MISCELLANEOUS_CALL_TYPE;
  const isActivate = !Number.isNaN(statusNumber) && statusNumber !== 0 && !isMiscellaneous;

  const roomResult = await pool.request()
    .input('organisationId', sql.NVarChar(50), String(orgId))
    .input('roomNo_deviceNo', sql.NVarChar(100), dnum)
    .input('floor', sql.Int, Number(floor))
    .query(
      `SELECT id FROM [Room] WHERE organisationId = @organisationId AND roomNo_deviceNo = @roomNo_deviceNo AND floor = @floor`
    );
  if (!roomResult.recordset.length) {
    return { httpStatus: 404, result: "FAILURE", error: `Room not found for room ${dnum} on floor ${floor}` };
  }
  const roomId = roomResult.recordset[0].id;

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

    const roomInfo = await pool.request().input('id', sql.NVarChar(50), roomId).query(`SELECT roomName FROM [Room] WHERE id = @id`);
    const roomName = roomInfo.recordset.length ? roomInfo.recordset[0].roomName : '';

    io.to(`org_${orgId}`).emit("call:new", withCallTypeFields(withCallStatusFields({
      id: existing.id,
      roomId,
      roomName,
      status: existing.currentStatus,
      callType: existing.callType ?? existing.currentStatus,
      timestamp: existing.dateTime || new Date(),
      muted: existing.isMuted === 1 || existing.isMuted === true,
      dateTimeReset: existing.dateTimeReset,
      minutesAgo: 0
    })));

    await writeActivityLog(pool, {
      organisationId: orgId,
      action: "call.repeated",
      entityType: "call",
      entityId: existing.id,
      message: `Repeated call: ${roomName}`,
      details: { roomId, dnum, floor },
    });

    return {
      httpStatus: 200,
      result: "SUCCESS",
      message: `Room ${dnum}: repeated call — announcement broadcast (call record unchanged)`,
    };
  }
  if (activeCallResult.recordset.length === 0 && isReset) {
    // Reset should not create a new call if none is active.
    return { httpStatus: 200, result: "SUCCESS", message: `Room ${dnum}: reset ignored (no active call)` };
  }
  if (activeCallResult.recordset.length > 0 && isReset) {
    const callId = activeCallResult.recordset[0].id;
    await pool.request()
      .input('id', sql.NVarChar(50), callId)
      .input('currentStatus', sql.Int, 0)
      .input('dateTimeReset', sql.DateTime, new Date())
      .query(`UPDATE [CallStatus] SET currentStatus = @currentStatus, dateTimeReset = @dateTimeReset WHERE id = @id`);
    io.to(`org_${orgId}`).emit("call:status", { id: callId, status: 0 });
    await writeActivityLog(pool, {
      organisationId: orgId,
      action: "call.resolved",
      entityType: "call",
      entityId: callId,
      message: `Call resolved: room ${dnum} (floor ${floor})`,
      details: { roomId, dnum, floor },
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
  const roomInfo = await pool.request().input('id', sql.NVarChar(50), roomId).query(`SELECT roomName FROM [Room] WHERE id = @id`);
  const roomName = roomInfo.recordset.length ? roomInfo.recordset[0].roomName : '';
  io.to(`org_${orgId}`).emit("call:new", withCallTypeFields(withCallStatusFields({
    id: callId,
    roomId,
    roomName,
    status: statusNumber,
    callType: statusNumber,
    timestamp: now,
    muted: false,
    dateTimeReset: isActivate ? null : now,
    minutesAgo: 0
  })));
  await writeActivityLog(pool, {
    organisationId: orgId,
    action: "call.created",
    entityType: "call",
    entityId: callId,
    message: `Device call: ${roomName} — ${getCallTypeName(statusNumber)}`,
    details: { roomId, dnum, floor, status: statusNumber },
  });
  return { httpStatus: 200, result: "SUCCESS", message: `Room ${dnum}: new call inserted (status ${statusNumber})` };
}

// Call status API contract (device integration)
app.get("/api/callstatus", (req: Request, res: Response) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.status(200).json({
    insertEndpoint: `${base}/api/callstatus/insert`,
    method: "GET",
    example: `${base}/api/callstatus/insert?orgId=00001&hid=1234567890&floor=1&r01=1&r02=2&r22=3`,
    queryParams: {
      orgId: "required — organisation id",
      hid: "required — 10-digit hardware id",
      floor: "required — floor number",
      "r{roomNo}": "required (one or more) — 2-digit zero-padded room device number with status value (e.g. r01, r02, r22)",
    },
    statusCodes: CALL_STATUS_MAP,
  });
});

// Insert record into CallStatus via GET (for device integration)
// URL: /api/callstatus/insert?orgId=00001&hid=1234567890&floor=1&r01=1&r02=2&r22=3
// r{roomNo}=0 reset | 1 normal | 2 emergency | 3 code blue | 4 toilet | 5 miscellaneous (reports only)
app.get("/api/callstatus/insert", async (req: Request, res: Response) => {
  const sendCallStatusResult = (httpStatus: number, ok: boolean) =>
    res.status(httpStatus).type("text/plain").send(ok ? "SUCCESS" : "FAILURE");

  const { orgId, hid, dnum, status, floor } = req.query;
  if (!orgId || !hid || floor === undefined || floor === "") {
    return sendCallStatusResult(400, false);
  }
  const hidStr = String(hid);
  if (!/^\d{10}$/.test(hidStr)) {
    return sendCallStatusResult(400, false);
  }
  const floorStr = String(Array.isArray(floor) ? floor[0] : floor);

  let roomUpdates = parseRoomStatusParams(req.query);
  if (roomUpdates.length === 0) {
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
    const repeatEnabled = await hasCallRepeatTable(pool);
    let worstStatus = 200;
    let allSuccess = true;

    for (const { roomNo, status: statusNumber } of roomUpdates) {
      const outcome = await processCallStatusForRoom(
        pool,
        String(orgId),
        floorStr,
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
  });
});

// Test DB connectivity
app.get('/api/test-db', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const table = process.env.USER_TABLE || 'User';

    // Try a simple query against the user table
    try {
      const r = await pool.request().query(`SELECT TOP 1 * FROM ${table}`);
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

// Test DB connectivity
app.get('/api/test-db', async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const table = process.env.USER_TABLE || 'User';

    // Try a simple query against the user table
    try {
      const r = await pool.request().query(`SELECT TOP 1 * FROM ${table}`);
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
});
