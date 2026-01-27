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

- **ADMIN_TOKEN**: A secure random token for admin authentication
  - Generate one: `openssl rand -hex 32`
  - Or use any secure random string

Example `.env`:
```
MONGODB_URI=mongodb://localhost:27017/leads
ADMIN_TOKEN=your-secure-random-token-here
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

- `POST /api/leads` - Submit a new lead
  - Body: `{ name, surname, phoneNumber }`

### Admin Endpoints (Require Authorization Header)

All admin endpoints require the `Authorization` header with the admin token:
```
Authorization: YOUR_ADMIN_TOKEN
```

- `POST /api/admin/login` - Admin login
  - Body: `{ token }`
  
- `GET /api/admin/leads` - Get all leads with status "new"
  - Headers: `Authorization: YOUR_ADMIN_TOKEN`

- `POST /api/admin/leads/:id/done` - Mark lead as done
  - Headers: `Authorization: YOUR_ADMIN_TOKEN`
  - Body: `{ comment }` (optional)

- `POST /api/admin/leads/:id/not` - Archive lead
  - Headers: `Authorization: YOUR_ADMIN_TOKEN`

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
