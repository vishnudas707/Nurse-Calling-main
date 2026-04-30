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
