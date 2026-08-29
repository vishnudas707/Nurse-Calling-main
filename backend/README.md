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
- `DELETE /api/rooms/:id` - Delete a room by ID

### Calls
- `GET /api/calls/active` - Get all active calls
- `POST /api/calls` - Create a new call
- `PUT /api/calls/:id` - Update call status

### Device call status (hardware integration)
- `GET /api/callstatus` - API contract, status codes, and example URL
- `GET /api/callstatus/insert` - Report room call states from devices

**Insert URL example:**
```
GET /api/callstatus/insert?orgId=00001&hid=1234567890&floor=1&r01=1&r02=2&r22=3
```

| Query | Description |
|-------|-------------|
| `orgId` | Organisation ID |
| `hid` | 10-digit hardware ID |
| `floor` | Floor number |
| `r{roomNo}` | 2-digit zero-padded room device number → status (e.g. `r01`, `r02`, `r22`; repeat for multiple rooms) |

| Status | Meaning | Color |
|--------|---------|-------|
| `0` | Reset | gray |
| `1` | Normal call | green |
| `2` | Emergency | red |
| `3` | Code blue | blue |
| `4` | Toilet | red |

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
