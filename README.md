# MVP Lead Management System

A minimal MVP web application for managing leads with a public form and admin panel.

## Features

- **Public Form**: Users can submit their contact information (name, surname, phone number)
- **Admin Panel**: Secure admin interface to manage leads
- **Token-based Authentication**: Simple token-based admin authentication
- **Lead Management**: Mark leads as "done" with comments or archive them

## Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: MongoDB (via Mongoose)
- **Frontend**: Plain HTML/CSS (no frameworks)
- **Environment**: dotenv for configuration

## Project Structure

```
mvp/
├── server.js              # Express server and API endpoints
├── package.json           # Dependencies
├── .env                   # Environment variables (create from .env.example)
├── .env.example           # Example environment variables
├── README.md              # This file
└── public/                # Static files
    ├── index.html         # Public form page
    ├── admin.html         # Admin panel
    └── styles.css         # Styling
```

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and replace the following:

- **MONGODB_URI**: Your MongoDB connection string
  - Local: `mongodb://localhost:27017/leads`
  - MongoDB Atlas: `mongodb+srv://username:password@cluster.mongodb.net/leads`

- **JWT_SECRET**: Secret used to sign JWT tokens (e.g. `openssl rand -hex 32`)
- **MANAGER_TOKEN**: Login token for Boss Manager (gets JWT with role `manager`)
- **CALL_MANAGER_TOKEN**: Login token for Call Manager (gets JWT with role `call_manager`)

Example `.env`:
```
MONGODB_URI=mongodb://localhost:27017/leads
JWT_SECRET=your-jwt-secret
MANAGER_TOKEN=your-manager-login-token
CALL_MANAGER_TOKEN=your-call-manager-login-token
PORT=3000
```

### 3. Start the Server

```bash
npm start
```

The server will start on `http://localhost:3000` (or the port specified in `.env`).

## Usage

### Public Form

- Visit: `http://localhost:3000/`
- Fill out the form with name, surname, and phone number
- Submit to create a new lead

### Admin Panel

- Visit: `http://localhost:3000/admin.html`
- Enter your admin token (from `.env` file)
- View all leads with status "new"
- Actions:
  - **DONE**: Mark lead as done (with optional comment)
  - **NOT**: Archive the lead (no call was made)

## API Endpoints

### Public Endpoints

- `POST /api/leads` - Submit a new lead (public form)
  - Body: `{ fullName, doorType, measurements, phoneNumber }`

### Admin Endpoints (Require Authorization Header)

Admin endpoints (except login) require JWT in the `Authorization` header:
```
Authorization: Bearer <JWT>
```

- `POST /api/admin/login` - Admin login (returns JWT and role)
  - Body: `{ token }` (MANAGER_TOKEN or CALL_MANAGER_TOKEN)
  
- `GET /api/admin/leads` - Get all leads with status "new"
  - Headers: `Authorization: Bearer <JWT>`

- `POST /api/admin/leads` - Add client manually (Manager only, 403 for Call Manager)
  - Headers: `Authorization: Bearer <JWT>`
  - Body: `{ fullName, doorType, measurements, phoneNumber }`

- `POST /api/admin/leads/:id/done` - Mark lead as done
  - Headers: `Authorization: Bearer <JWT>`
  - Body: `{ comment }` (optional)

- `POST /api/admin/leads/:id/not` - Archive lead
  - Headers: `Authorization: Bearer <JWT>`

- `GET /api/admin/done-calls` - Get all leads with status "done"
  - Headers: `Authorization: Bearer <JWT>`

## Lead Status

Leads have three possible statuses:

- **new**: Default status for newly submitted leads
- **done**: Lead was processed (with optional comment)
- **archived**: Lead was archived (no call was made)

## Security Notes

- Admin token is stored in `.env` file (never commit this file)
- Token-based authentication (simple but effective for MVP)
- All admin routes are protected
- Token must be sent via `Authorization` header

## Development

- Server auto-reloads on changes (if using nodemon)
- MongoDB connection is established on server start
- All errors are logged to console

## License

ISC
