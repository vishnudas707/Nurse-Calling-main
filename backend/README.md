# Nurse Calling System - Backend API

This is the backend server for the Nurse Calling System application built with Express.js and TypeScript.

## Setup Instructions

### Prerequisites
- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

### Environment Configuration

The `.env` file contains the following variables:
- `PORT`: Server port (default: 5000)
- `NODE_ENV`: Environment (development/production)

#### Database connection

`DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`, `DB_ENCRYPT`,
`DB_TRUST_CERT` configure the SQL Server connection itself.

The pool is self-healing and normally needs no tuning. These knobs exist so it
can be adjusted without a code change:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_POOL_MAX` | `20` | Max pooled connections (= max sessions on SQL Server) |
| `DB_POOL_MIN` | `1` | Warm connections kept open while idle |
| `DB_REQUEST_TIMEOUT` | `60000` | Max ms for one query |
| `DB_POOL_ACQUIRE_TIMEOUT` | request timeout + 10s | Max ms to wait for a free connection. Keep it **≥** `DB_REQUEST_TIMEOUT`, or one slow query makes every other caller fail |
| `DB_HEARTBEAT_INTERVAL` | `60000` | How often `SELECT 1` proves the link is alive. Also keeps the NAT/firewall mapping to the DB host warm |
| `DB_HEARTBEAT_TIMEOUT` | `15000` | How long a probe may hang before it counts as failed |
| `DB_HEARTBEAT_MAX_FAILURES` | `3` | Consecutive failed probes before the pool is recycled |
| `DB_HEARTBEAT_MAX_SATURATED` | `10` | Consecutive probes blocked purely by a full pool before it is recycled |

`GET /api/health` reports live pool counters (`size`, `borrowed`, `pending`,
`heartbeatFailures`, `lastPoolError`) — check it first when the service stops
reaching the database.

### Database indexes

Run `migrations/performance-indexes.sql` once against the database. Without it,
every device button press scans the whole `CallStatus` table, so the service
gets progressively slower as call history accumulates.

### Running the Server

**Development mode** (with hot reload):
```bash
npm run dev
```

**Production mode**:
```bash
npm run build
npm start
```

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration

### Room Management
- `GET /api/rooms` - Get all rooms
- `POST /api/rooms` - Create a new room
- `PUT /api/rooms/:id` - Update a room by ID
- `DELETE /api/rooms/:id` - Delete a room by ID

Create and update accept `hid` (10-digit string, or `null` to clear it): the
hardware ID of the device that reports the room, picked in the settings page
from the organisation's registered HIDs. It is stored in `[Room].hid`, which the
server adds to the table on demand the first time `GET /api/rooms` runs, and it
is what identifies the room on a device call — see the device call status
section below. `floor` is descriptive only (stored as `0` when unset) and plays
no part in routing calls.

Device numbers are scoped to a device, so **every HID gets its own full set** —
`r01`…`r12` on `2408202601` and `r01`…`r12` on `2408202602` are 24 different
rooms. What must stay unique is the triple the call lookup resolves on:
organisation + HID + device number. Reusing a device number on the *same* HID is
rejected with `409`, since `SELECT TOP 1` would otherwise pick between the two
rooms arbitrarily. Rooms with no HID form their own group, because an exact HID
match always outranks a HID-less room in the lookup.

### Calls
- `GET /api/calls/active` - Get all active calls
- `POST /api/calls` - Create a new call
- `PUT /api/calls/:id` - Update call status
- `GET /api/calls/history` - Paged call history for the reports

`/api/calls/active` and `/api/calls/history` both accept an optional `hid` or
`floor` alongside `organisationId`, and both return `hid` and `floor` on every
row. This is what lets one login split into per-device views: the dashboard
watches two scopes at once, and the reports narrow to one. History is filtered
in SQL rather than in the browser so `totalCount` and paging stay correct.

### Device call status (hardware integration)
- `GET /api/callstatus` - API contract, status codes, and example URL
- `GET /api/callstatus/insert` - Report room call states from devices

**Insert URL example:**
```
GET /api/callstatus/insert?orgId=00001&hid=1234567890&r01=1&r02=2&r22=3
```

| Query | Description |
|-------|-------------|
| `orgId` | Organisation ID |
| `hid` | 10-digit hardware ID — matched against `[Room].hid` to pick the room |
| `r{roomNo}` | 2-digit zero-padded room device number → status (e.g. `r01`, `r02`, `r22`; repeat for multiple rooms) |

There is no `floor` parameter. A stray `floor=` left in an older device's URL is
ignored rather than rejected, so nothing has to be reprogrammed at once.

| Status | Meaning | Color |
|--------|---------|-------|
| `0` | Reset | gray |
| `1` | Normal call | green |
| `2` | Emergency | red |
| `3` | Code blue | blue |
| `4` | Toilet | red |

**Room lookup:** a room is identified by `orgId` + `hid` + `r{roomNo}`. Floor is
not consulted: one device can cover several floors and several devices can share
one, so it never disambiguated anything the HID does not. A room whose `hid`
matches the reporting device wins; a room with no `hid` set is still matched, so
sites that never filled the field in keep working. A room belonging to a
*different* device is never matched.

**Floor:** the device does not report one. Once the room is matched, the server
reads `[Room].floor` and attaches it to the call — on the `call:new` socket
payload, on `GET /api/calls/active`, on `GET /api/calls/history` and in the
activity log. So the floor a call is shown under is whatever the room is set to
at the moment it comes in: change a room's floor in the settings page and the
next call reports the new one, with nothing to change on the hardware.

**Insert response:** plain text `SUCCESS` when all rooms succeed, otherwise `FAILURE` (no JSON body).

### Health Check
- `GET /api/health` - Server health status

## Project Structure

```
backend/
├── server.ts          # Main server file
├── package.json       # Dependencies
├── tsconfig.json      # TypeScript configuration
├── .env               # Environment variables
└── README.md          # This file
```

## Notes

- Currently uses in-memory storage for data
- TODO: Integrate with a database (MongoDB, PostgreSQL, etc.)
- TODO: Implement JWT authentication
- TODO: Add request validation and error handling
