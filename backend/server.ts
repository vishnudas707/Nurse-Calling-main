
import express, { Express, Request, Response } from "express";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { getPool, sql } from "./db";
import { ROOM_TYPE_MAP, DEPARTMENT_TYPE_MAP, getRoomTypeName, getDepartmentTypeName, } from "./constants";

dotenv.config();

const USER_TABLE = process.env.USER_TABLE || 'User';


const app: Express = express();
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: "*" }
});
const PORT = process.env.PORT || 5001;

// Repeated call logging (minimal, additive)
// IMPORTANT: This service user may not have DDL permissions in production.
// So we only *use* CallRepeat table if it already exists.
async function hasCallRepeatTable(pool: any): Promise<boolean> {
  try {
    const r = await pool.request().query(`SELECT OBJECT_ID(N'[dbo].[CallRepeat]', N'U') AS objId`);
    return !!r?.recordset?.[0]?.objId;
  } catch (err) {
    console.error('[CallRepeat] Table existence check failed:', err);
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

    const token = jwt.sign({ id, role }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '8h' });

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

    const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET || 'dev_secret', { expiresIn: '8h' });

    return res.status(200).json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role, organisationId: user.organisationId }, token });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Login failed' });
  }
});

// Room Management Routes (MSSQL-backed)
const ROOM_TABLE = 'Room';

// GET all rooms
app.get("/api/rooms", async (req: Request, res: Response) => {
  try {
    const pool = await getPool();
    const result = await pool.request().query(`SELECT * FROM [${ROOM_TABLE}] WHERE active = 1 ORDER BY id`);
    
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
    const existsResult = await checkReq.query(`SELECT id FROM [${ROOM_TABLE}] WHERE id = @id`);
    
    if (existsResult.recordset.length === 0) {
      return res.status(404).json({ success: false, error: "Room not found" });
    }

    const deleteReq = pool.request();
    deleteReq.input('id', sql.NVarChar(50), id);
    
    await deleteReq.query(`UPDATE [${ROOM_TABLE}] SET active = 0 WHERE id = @id`);

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
    console.log('[CALLS ACTIVE] Fetching active calls from DB with room name join');
    const pool = await getPool();
    // Join CallStatus with Rooms to get roomName
    const result = await pool.request().query(
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[dateTime], cs.[isMuted], cs.[dateTimeReset], r.[roomName]
       FROM [CallStatus] cs
       LEFT JOIN [Room] r ON cs.[roomId] = r.[id]
       WHERE cs.[currentStatus] <> 0
       ORDER BY cs.[dateTime] DESC`
    );
    const now = Date.now();
    const calls = result.recordset.map((row: any) => ({
      id: row.id,
      roomId: row.roomId,
      roomName: row.roomName || '',
      status: row.currentStatus,
      timestamp: row.dateTime,
      minutesAgo: row.dateTime ? Math.floor((now - new Date(row.dateTime).getTime()) / 60000) : null,
      muted: row.isMuted === 1 || row.isMuted === true,
      dateTimeReset: row.dateTimeReset,
    }));
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
  const { roomId, organisationId } = req.body;
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
    const insertReq = pool.request();
    insertReq.input("id", sql.NVarChar(50), callId);
    insertReq.input("roomId", sql.NVarChar(50), roomId);
    insertReq.input("currentStatus", sql.Int, 1); // 1 - Active
    insertReq.input("dateTime", sql.DateTime, now);
    insertReq.input("isMuted", sql.Int, 0);
    insertReq.input("mutedDateTime", sql.DateTime, null);
    insertReq.input("dateTimeReset", sql.DateTime, null);
    await insertReq.query(
      `INSERT INTO [CallStatus] (id, roomId, currentStatus, dateTime, isMuted, mutedDateTime, dateTimeReset)
       VALUES (@id, @roomId, @currentStatus, @dateTime, @isMuted, @mutedDateTime, @dateTimeReset)`
    );

    const roomInfo = await pool.request()
      .input('id', sql.NVarChar(50), roomId)
      .query(`SELECT roomName FROM [Room] WHERE id = @id`);
    const roomName = roomInfo.recordset.length ? roomInfo.recordset[0].roomName : '';

    const newCall = {
      id: callId,
      roomId,
      roomName,
      status: 1,
      timestamp: now,
      minutesAgo: 0,
      muted: false,
      dateTimeReset: null,
      organisationId
    };

    io.to(`org_${organisationId}`).emit("call:new", newCall);
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
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[dateTime], cs.[isMuted], cs.[mutedDateTime], cs.[dateTimeReset], r.[roomName]
       FROM [CallStatus] cs
       LEFT JOIN [Room] r ON cs.[roomId] = r.[id]
       WHERE cs.[id] = @id`
    );
    const row = result.recordset[0];
    const call = row ? {
      id: row.id,
      roomId: row.roomId,
      roomName: row.roomName || '',
      status: row.currentStatus,
      timestamp: row.dateTime,
      minutesAgo: row.dateTime ? Math.floor((Date.now() - new Date(row.dateTime).getTime()) / 60000) : null,
      muted: row.isMuted === 1 || row.isMuted === true,
      mutedDateTime: row.mutedDateTime,
      dateTimeReset: row.dateTimeReset,
      organisationId
    } : null;

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
    const { startDate, endDate, search, status, room, muted, page = 1, pageSize = 10 } = req.query;
    const pool = await getPool();
    const repeatEnabled = await hasCallRepeatTable(pool);
    let query =
      `SELECT cs.[id], cs.[roomId], cs.[currentStatus], cs.[dateTime], cs.[isMuted], cs.[mutedDateTime], cs.[dateTimeReset], r.[roomName], r.[departmentType], r.[roomType], r.[floor]${
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
      where.push('cs.[currentStatus] = @status');
      params.push({ name: 'status', type: sql.Int, value: Number(status) });
    }
    if (room) {
      where.push('cs.[roomId] = @room');
      params.push({ name: 'room', type: sql.NVarChar, value: room });
    }
    if (muted) {
      where.push('cs.[isMuted] = @muted');
      params.push({ name: 'muted', type: sql.Bit, value: muted === 'true' ? 1 : 0 });
    }
    if (where.length > 0) {
      query += ' WHERE ' + where.join(' AND ');
    }
    query += ' ORDER BY cs.[dateTime] DESC';
    // Get total count for pagination
    let countQuery = 'SELECT COUNT(*) as total FROM [CallStatus] cs LEFT JOIN [Room] r ON cs.[roomId] = r.[id]';
    if (where.length > 0) {
      countQuery += ' WHERE ' + where.join(' AND ');
    }
    const reqDb = pool.request();
    params.forEach(p => reqDb.input(p.name, p.type, p.value));
    const countResult = await reqDb.query(countQuery);
    const totalCount = countResult.recordset[0]?.total || 0;
    const totalPages = Math.ceil(totalCount / Number(pageSize));
    // Add pagination to main query
    query += ` OFFSET ${(Number(page) - 1) * Number(pageSize)} ROWS FETCH NEXT ${Number(pageSize)} ROWS ONLY`;
    const result = await reqDb.query(query);
    const calls = result.recordset.map((row: any) => ({
      id: row.id,
      roomId: row.roomId,
      roomName: row.roomName || '',
      status: row.currentStatus === true ? 'Active' : row.currentStatus === false ? 'Resolved' : row.currentStatus,
      timestamp: row.dateTime,
      muted: row.isMuted === 1 || row.isMuted === true,
      mutedDateTime: row.mutedDateTime,
      dateTimeReset: row.dateTimeReset,
      departmentType: row.departmentType,
      roomType: row.roomType,
      floor: row.floor,
      repeatCount: row.repeatCount || 0,
      lastRepeatAt: row.lastRepeatAt,
      // Repeat duration is measured from after the call start time (dateTime) to the latest repeatAt.
      // If there is no repeat, this will be null.
      repeatDurationMinutes:
        row.lastRepeatAt && row.dateTime
          ? Math.max(0, Math.floor((new Date(row.lastRepeatAt).getTime() - new Date(row.dateTime).getTime()) / 60000))
          : null,
    }));
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
// Insert record into CallStatus via GET (for device integration)
app.get("/api/callstatus/insert", async (req: Request, res: Response) => {
  const { orgId, dnum, status, floor } = req.query;
  if (!orgId || !dnum || status === undefined || !floor) {
    return res.status(400).json({ result: "FAILURE", error: "Missing orgId, dnum, status, or floor" });
  }
  try {
    const pool = await getPool();
    const repeatEnabled = await hasCallRepeatTable(pool);
    const statusNumber = Number(status);
    const isReset = statusNumber === 0;
    const isActivate = !Number.isNaN(statusNumber) && statusNumber !== 0;

    // Lookup roomId from Room table using roomNo_deviceNumber and floor
    const roomResult = await pool.request()
      .input('roomNo_deviceNo', sql.NVarChar(100), dnum)
      .input('floor', sql.Int, Number(floor))
      .query(`SELECT id FROM [Room] WHERE roomNo_deviceNo = @roomNo_deviceNo AND floor = @floor`);
    if (!roomResult.recordset.length) {
      return res.status(404).json({ result: "FAILURE", error: "Room not found for given roomNo_deviceNumber and floor" });
    }
    const roomId = roomResult.recordset[0].id;
    // Check for existing active call for this room
    const activeCallResult = await pool.request()
      .input('roomId', sql.NVarChar(50), roomId)
      .query(`SELECT TOP 1 id, currentStatus, dateTime, isMuted, dateTimeReset FROM [CallStatus] WHERE roomId = @roomId AND currentStatus <> 0 ORDER BY dateTime DESC`);
    if (activeCallResult.recordset.length > 0 && isActivate) {
      // Already active: do not create duplicates, but re-announce to dashboard
      const existing = activeCallResult.recordset[0];

      // Log the repeated call timestamp for reporting
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

      io.to(`org_${orgId}`).emit("call:new", {
        id: existing.id,
        roomId,
        roomName,
        status: existing.currentStatus,
        timestamp: existing.dateTime || new Date(),
        muted: existing.isMuted === 1 || existing.isMuted === true,
        dateTimeReset: existing.dateTimeReset,
        minutesAgo: 0
      });

      return res.status(200).json({
        result: "SUCCESS",
        message: "Repeated call — announcement broadcast to dashboard (call record unchanged)",
      });
    }
    if (activeCallResult.recordset.length > 0 && isReset) {
      // Update status to 0 (reset the existing active call)
      const callId = activeCallResult.recordset[0].id;
      await pool.request()
        .input('id', sql.NVarChar(50), callId)
        .input('currentStatus', sql.Int, 0)
        .input('dateTimeReset', sql.DateTime, new Date())
        .query(`UPDATE [CallStatus] SET currentStatus = @currentStatus, dateTimeReset = @dateTimeReset WHERE id = @id`);
      // Emit socket event for reset
      io.to(`org_${orgId}`).emit("call:status", { id: callId, status: 0 });
      return res.status(200).json({ result: "SUCCESS", message: "Call status reset" });
    }
    if (!isActivate && !isReset) {
      return res.status(400).json({ result: "FAILURE", error: "Invalid status" });
    }
    // No active call, insert new
    const callId = `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const insertReq = pool.request();
    insertReq.input("id", sql.NVarChar(50), callId);
    insertReq.input("roomId", sql.NVarChar(50), roomId);
    insertReq.input("currentStatus", sql.Int, statusNumber); // non-zero is active, 0 is reset
    const now = new Date();
    insertReq.input("dateTime", sql.DateTime, now);
    insertReq.input("isMuted", sql.Int, 0);
    insertReq.input("mutedDateTime", sql.DateTime, 0 ? now : null);
    if (isActivate) { insertReq.input("dateTimeReset", sql.DateTime, null); }
    else { insertReq.input("dateTimeReset", sql.DateTime, now); }
    const insertQuery = `INSERT INTO [CallStatus] (id, roomId, currentStatus, dateTime, isMuted, mutedDateTime, dateTimeReset) VALUES (@id, @roomId, @currentStatus, @dateTime, @isMuted, @mutedDateTime, @dateTimeReset)`;
    await insertReq.query(insertQuery);
    // Fetch roomName for the card
    const roomInfo = await pool.request().input('id', sql.NVarChar(50), roomId).query(`SELECT roomName FROM [Room] WHERE id = @id`);
    const roomName = roomInfo.recordset.length ? roomInfo.recordset[0].roomName : '';
    // Emit socket event for new call with full info
    io.to(`org_${orgId}`).emit("call:new", {
      id: callId,
      roomId,
      roomName,
      status: statusNumber,
      timestamp: now,
      muted: false,
      dateTimeReset: isActivate ? null : now,
      minutesAgo: 0
    });
    return res.status(200).json({ result: "SUCCESS", message: "New call inserted" });
  } catch (err) {
    console.error('[CALLSTATUS INSERT] Error:', err);
    return res.status(500).json({ result: "FAILURE", error: "DB insert/update failed" });
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
