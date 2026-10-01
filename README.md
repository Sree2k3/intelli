# IntelliHire — AI Interview Platform

An AI-powered technical interview platform that conducts multi-round interviews (Technical Q&A → Coding Challenge → Behavioral) with real-time code execution in Python, JavaScript, Java, and C++.

---

## Prerequisites

Make sure the following are installed on your system **before** starting:

| Tool | Version | Why |
|---|---|---|
| **Node.js** | ≥ 18.x | Frontend (Vite + React) |
| **npm** | ≥ 9.x | Package manager (comes with Node) |
| **Python** | ≥ 3.10 | Backend API server |
| **pip** | ≥ 22.x | Python package installer |
| **PostgreSQL** | ≥ 14.x | Database |
| **g++** | ≥ 11.x | C++ code execution *(optional)* |
| **javac / java** | ≥ 17 | Java code execution *(optional)* |
| **Groq API Key** | — | Cloud LLM for AI interview *(or Ollama for local)* |

> **Windows users**: Install Python from [python.org](https://www.python.org/downloads/), Node.js from [nodejs.org](https://nodejs.org/), and PostgreSQL from [postgresql.org](https://www.postgresql.org/download/windows/). For C++/Java, install [MinGW-w64](https://www.mingw-w64.org/) and [JDK 17+](https://adoptium.net/).

---

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/CodeByRohanV/Interview_platform.git
cd Interview_platform
```

### 2. Install Frontend Dependencies

```bash
npm install
```

### 3. Install Backend Dependencies

```bash
cd backend
pip install -r requirements.txt
```

> **Tip**: Use a virtual environment to keep things clean:
> ```bash
> python -m venv venv
> # Windows:
> venv\Scripts\activate
> # macOS/Linux:
> source venv/bin/activate
> pip install -r requirements.txt
> ```

### 4. Set Up PostgreSQL Database

Make sure PostgreSQL is running, then:

```bash
# Option A: Automatic (recommended)
cd backend
python init_db.py

# Option B: Manual
psql -U postgres -c "CREATE DATABASE intellihire;"
psql -U postgres -d intellihire -f backend/setup_db.sql
```

### 5. Configure Environment Variables

#### Backend (`backend/.env`)

Create or edit `backend/.env`:

```env
# Database connection (update password to match your PostgreSQL setup)
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/intellihire

# JWT settings
JWT_SECRET=your_random_secret_key_here
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440

# LLM Provider — choose ONE:

# Option A: Groq (cloud, recommended — get a free key at https://console.groq.com)
GROQ_API_KEY=gsk_your_groq_api_key_here
GROQ_MODEL=openai/gpt-oss-120b

# Option B: Ollama (local, no API key needed — install from https://ollama.ai)
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.1:8b

# Frontend origin (must match the Vite dev server port)
FRONTEND_ORIGIN=http://localhost:8080
```

#### Frontend (`.env` in project root)

Create or edit `.env` in the project root:

```env
VITE_API_BASE_URL=http://localhost:8000
```

### 6. Start the Backend

```bash
cd backend
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

You should see:
```
INFO:     Uvicorn running on http://0.0.0.0:8000
INFO:     Application startup complete.
```

### 7. Start the Frontend

Open a **new terminal** in the project root:

```bash
npm run dev
```

You should see:
```
VITE v5.x.x  ready in XXXms
➜  Local:   http://localhost:8080/
```

### 8. Open the App

Open your browser and go to: **http://localhost:8080**

---

## Project Structure

```
Interview_platform/
├── .env                     # Frontend env vars
├── index.html               # Vite entry point
├── package.json             # Frontend dependencies
├── vite.config.ts           # Vite configuration
├── tailwind.config.ts       # Tailwind CSS config
│
├── src/                     # Frontend (React + TypeScript)
│   ├── App.tsx              # Root component + routing
│   ├── main.tsx             # Entry point
│   ├── pages/               # Page components
│   ├── components/          # Reusable UI components
│   ├── hooks/               # Custom React hooks
│   ├── integrations/        # API client & types
│   └── lib/                 # Utility functions
│
├── backend/                 # Backend (Python + FastAPI)
│   ├── main.py              # API server (all endpoints)
│   ├── auth.py              # JWT authentication
│   ├── config.py            # Environment settings
│   ├── database.py          # Async DB connection
│   ├── models.py            # SQLAlchemy ORM models
│   ├── llm_service.py       # AI/LLM integration (Groq/Ollama)
│   ├── evaluation_service.py# Interview evaluation engine
│   ├── executor.py          # Multi-language code runner
│   ├── init_db.py           # Database initialization script
│   ├── setup_db.sql         # Raw SQL schema
│   ├── upgrade_db.py        # DB migration runner
│   └── requirements.txt     # Python dependencies
│
└── public/                  # Static assets
```

---

## Features

- **AI-Powered Interviews** — LLM conducts adaptive technical, coding, and behavioral rounds
- **Multi-Language Code Execution** — Run & evaluate code in Python, JavaScript, Java, and C++
- **Real-Time Code Editor** — Monaco editor (same as VS Code) with syntax highlighting
- **Invite-Based Candidates** — Generate unique invite links for candidates
- **Automated Scoring** — AI evaluates answers and generates detailed reports
- **Interview Results Dashboard** — View scores, feedback, and AI recommendations

---

## Supported Languages for Coding Round

| Language | Runtime Required | Tested |
|---|---|---|
| Python | `python` on PATH | ✅ |
| JavaScript | `node` on PATH | ✅ |
| Java | `javac` + `java` on PATH | ✅ |
| C++ | `g++` on PATH | ✅ |

> To verify these are installed, run:
> ```bash
> python --version
> node --version
> javac -version
> g++ --version
> ```

---

## Common Issues

| Issue | Solution |
|---|---|
| `CORS error` in browser | Make sure `FRONTEND_ORIGIN` in `backend/.env` matches your frontend URL (default: `http://localhost:8080`) |
| `Connection refused` on port 8000 | Backend isn't running — run `uvicorn main:app --port 8000 --reload` in `backend/` |
| `Database does not exist` | Run `python init_db.py` in `backend/` |
| `GROQ_API_KEY not set` | Get a free key at [console.groq.com](https://console.groq.com) and add it to `backend/.env` |
| `g++` / `javac` not found | Install MinGW-w64 (C++) or JDK 17+ (Java) and add to your system PATH |
| `Module not found: executor` | Make sure you're running `uvicorn` from inside the `backend/` directory |

---

## API Endpoints (Key)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/v1/signup` | Register new user |
| `POST` | `/auth/v1/token` | Login / get JWT |
| `POST` | `/rest/v1/interviews` | Create interview |
| `POST` | `/rest/v1/coding_questions` | Parse coding questions |
| `POST` | `/functions/v1/ai-interview` | AI interview conversation |
| `POST` | `/functions/v1/execute-code` | Run code (test) |
| `POST` | `/functions/v1/submit-coding` | Submit code (evaluate) |
| `GET`  | `/rest/v1/interviews/{id}/results` | Get interview results |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| Backend | Python, FastAPI, SQLAlchemy (async), Pydantic |
| Database | PostgreSQL |
| AI/LLM | Groq Cloud API / Ollama (local) |
| Code Editor | Monaco Editor (VS Code engine) |
| Code Execution | Local subprocess (Python, Node.js, g++, javac) |

---

## License

This project is for educational and portfolio purposes.
