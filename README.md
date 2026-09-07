# DocDesk — Clinic Management System

A unified web application for veterinary (and general) clinics to manage patients, appointments, billing, medications, and generate PDF receipts and Excel exports.

## Tech Stack

| Layer | Technology |
|---|---|
| Database | PostgreSQL via [Supabase](https://supabase.com) |
| Backend | Node.js + Express |
| DB client | `pg` |
| Auth | JWT + bcrypt |
| PDF generation | Puppeteer |
| Excel export | SheetJS (`xlsx`) |
| Frontend | React 18 + Vite |
| Data fetching | TanStack Query v5 |
| Styling | Tailwind CSS v3 |

## Project Structure

```
DocDesk/
├── client/          # React frontend (Vite)
├── server/          # Express REST API
├── db/              # SQL schema + ER diagram
├── ml/              # Placeholder for future ML models
├── .gitignore
└── README.md
```

## Prerequisites

- **Node.js** v18 or later
- **npm** v9 or later
- A free [Supabase](https://supabase.com) account

---

## Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/quirky-sharan/DocDesk.git
cd DocDesk
```

### 2. Set up the database (Supabase)

1. Create a new project at [app.supabase.com](https://app.supabase.com)
2. Go to **SQL Editor** and paste the contents of `db/schema.sql`, then click **Run**
3. Copy your **connection string** from `Project Settings → Database → Connection string (URI mode)`

### 3. Configure the backend

```bash
cd server
cp .env.example .env
```

Edit `server/.env`:

```
DATABASE_URL=postgresql://postgres:<your-password>@<your-host>:5432/postgres
JWT_SECRET=change_this_to_a_long_random_string
PORT=5000
```

```bash
npm install
```

### 4. Configure the frontend

```bash
cd ../client
cp .env.example .env
```

Edit `client/.env`:

```
VITE_API_URL=http://localhost:5000/api
```

```bash
npm install
```

### 5. Run in development

Open **two terminal tabs**:

**Tab 1 — Backend:**
```bash
cd server
npm run dev
# → Server running on http://localhost:5000
```

**Tab 2 — Frontend:**
```bash
cd client
npm run dev
# → Vite dev server at http://localhost:5173
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | No | Register a new user |
| POST | `/api/auth/login` | No | Login, returns JWT |
| GET  | `/api/patients` | Yes | List all patients |
| POST | `/api/patients` | Yes | Create patient |
| GET  | `/api/patients/:id` | Yes | Get single patient |
| PUT  | `/api/patients/:id` | Yes | Update patient |
| DELETE | `/api/patients/:id` | Yes | Delete patient |
| GET  | `/api/appointments` | Yes | List appointments |
| POST | `/api/appointments` | Yes | Create appointment |
| GET/PUT/DELETE | `/api/appointments/:id` | Yes | Single appointment |
| GET  | `/api/medications` | Yes | List medications |
| POST | `/api/medications` | Yes | Add medication |
| GET/PUT/DELETE | `/api/medications/:id` | Yes | Single medication |
| GET  | `/api/billing` | Yes | List bills |
| POST | `/api/billing` | Yes | Create bill |
| GET  | `/api/billing/:id/pdf` | Yes | Download bill as PDF |
| GET  | `/api/export/patients` | Yes | Export patients as Excel |
| GET  | `/api/export/billing` | Yes | Export billing as Excel |

Pass JWT in the `Authorization: Bearer <token>` header for all protected routes.

---

## Deployment

### Backend (Render / Railway)
1. Connect your GitHub repo on [Render](https://render.com) or [Railway](https://railway.app)
2. Set the **build command**: `cd server && npm install`
3. Set the **start command**: `node server/index.js`
4. Add the environment variables from `server/.env`

### Frontend (Vercel / Netlify)
1. Connect your GitHub repo
2. Set **root directory** to `client`
3. Set **build command**: `npm run build`
4. Set **publish directory**: `dist`
5. Add `VITE_API_URL` pointing to your deployed backend URL

---

## Roles

| Role | Permissions |
|------|-------------|
| `admin` | Full access |
| `doctor` | Patients, appointments, prescriptions, view billing |
| `receptionist` | Patients, appointments, billing / receipts |

---

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit: `git commit -m "feat: add my feature"`
4. Push and open a Pull Request

---

## License

MIT
