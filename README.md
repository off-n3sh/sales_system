# 📦 Order Management System

A lightweight, open-source order management system built for small to medium businesses. Clean stack, straightforward setup, built to learn and ship.

> 🚧 **Under active development**.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML, JavaScript, Jinja2 |
| Backend | Python, Flask |
| Database | MongoDB |
| Server | Gunicorn (Linux/macOS), Waitress (Windows), Flask dev server (development) |

---

## Project Structure

```
order-system/
├── app.py                  # Main Flask application
├── admin_routes.py         # Admin service routes
├── requirements.txt        # Python dependencies
├── templates/              # Jinja2 HTML templates
├── static/                 # CSS, JS, assets
├── deploy_linux.sh         # Linux/Debian/Ubuntu — full auto deploy
└── deploy_windows.ps1      # Windows — full auto deploy 
```

---

## Getting Started

### Prerequisites

| | Linux / macOS | Windows |
|--|---------------|---------|
| Python | 3.10+ | 3.10+ |
| MongoDB | 7.0+ | 7.0+ |
| Git | any | any |
| Shell | bash | PowerShell 5.1+ (built into Windows 10/11) |

---

## Option A — Automated Deploy

Both scripts handle everything end to end: MongoDB config, user creation, virtual environment, dependency install, and service registration. Run steps individually or choose **option 9** for a full one-shot deploy.

**Linux (Debian / Ubuntu)**

```bash
git clone https://github.com/0ff-n3sh/sales_system.git
cd sales_system
chmod +x deploy_linux.sh
./deploy_linux.sh
```

Services are registered as systemd units and auto-start on boot.

**Windows (PowerShell — run as Administrator)**

```powershell
git clone https://github.com/0ff-n3sh/sales_system.git
cd sales_system

# Allow script execution for this session
Set-ExecutionPolicy Bypass -Scope Process

.\deploy_windows.ps1
```

The script self-elevates if not already running as Administrator. Services are registered via NSSM and auto-start on boot, with MongoDB declared as a dependency so startup order is always correct.

---

## Option B — Manual Setup (Development)

### 1. Clone the repo

```bash
git clone https://github.com/your-username/order-system.git
cd order-system
```

### 2. Create and activate a virtual environment

**Linux / macOS**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

**Windows (PowerShell)**
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

**Windows (Command Prompt)**
```cmd
python -m venv .venv
.venv\Scripts\activate.bat
```

### 3. Install dependencies

```bash
pip install --upgrade pip
pip install -r requirements.txt
```

> **Windows note:** `gunicorn` does not run on Windows. The requirements file includes `waitress` as the Windows WSGI server. Both are installed — use the right one for your platform.

### 4. Configure environment variables

Create a `.env` file in the project root. **Never commit this file.**

```env
MONGO_USER=dreamland
MONGO_PASS=your_password_here
MONGO_HOST=localhost
MONGO_DB=dreamland_zero
MONGO_LOG=/var/log/mongodb/mongod.log
ADMIN_PORT=5002
ADMIN_MONGO_USER=rootadmin
ADMIN_MONGO_PASS=your_admin_password_here
```

> **Windows users:** update `MONGO_LOG` to your local path, e.g.
> `MONGO_LOG=C:\Program Files\MongoDB\Server\7.0\log\mongod.log`

### 5. Start MongoDB

**Linux**
```bash
sudo systemctl start mongod
```

**macOS**
```bash
brew services start mongodb-community
```

**Windows (PowerShell — Administrator)**
```powershell
Start-Service -Name MongoDB
```

**Windows (Command Prompt — Administrator)**
```cmd
net start MongoDB
```

### 6. Run the application

**Development — Flask dev server (all platforms)**

```bash
# Main app
python app.py

# Admin service (separate terminal)
python admin_routes.py
```

**Linux / macOS — Gunicorn**

```bash
# Main app
gunicorn --bind 0.0.0.0:5000 --workers 2 --reload app:app

# Admin service (separate terminal)
gunicorn --bind 0.0.0.0:5002 --workers 2 --reload admin_routes:app
```

**Windows — Waitress**

```powershell
# Main app
waitress-serve --host=0.0.0.0 --port=5000 app:app

# Admin service (separate terminal)
waitress-serve --host=0.0.0.0 --port=5002 admin_routes:app
```

The app will be available at:
- **Main app** → `http://localhost:5000`
- **Admin panel** → `http://localhost:5002`
change as it suits your preferences 

---

## Deployment (Production)

### Linux — systemd

```bash
./deploy_linux.sh
# Steps 1–7 in order, or option 9 for full auto deploy
```

What it sets up:
- MongoDB config with `authorization: enabled` and `bindIp`
- Admin and app DB users with verified credentials
- Python venv and all dependencies
- Two systemd services (`order-app`, `order-admin`) with `Restart=always`
- Environment file readable only by root

### Windows — NSSM Services

```powershell
.\deploy_windows.ps1
# Steps 1–7 in order, or option 9 for full auto deploy
```

What it sets up:
- MongoDB installation (via winget or MSI fallback) and `mongod.cfg` with auth + bindIp
- Admin and app DB users with verified credentials
- Python venv and all dependencies
- Two Windows services (`order-app`, `order-admin`) via NSSM with auto-restart
- Environment file locked to Administrators + SYSTEM via NTFS ACLs

### Deployment script menu reference

Both scripts share the same menu structure:

| Option | Action |
|--------|--------|
| 1 | Check / install Python |
| 2 | Check / install MongoDB |
| 3 | Configure MongoDB, verify users and credentials |
| 4 | Write environment file |
| 5 | Deploy app files + venv + pip install |
| 6 | Register services (systemd / NSSM) |
| 7 | Start / restart services |
| 8 | Status summary |
| 9 | Full auto deploy (runs 1–7) |

---

## Dependencies

| Package | Purpose | Platform |
|---------|---------|----------|
| Flask | Web framework | All |
| pymongo | MongoDB driver | All |
| python-dotenv | Load `.env` config | All |
| Jinja2 | Templating (bundled with Flask) | All |
| gunicorn | WSGI server | Linux / macOS |
| waitress | WSGI server | Windows |

---

## Contributing

Open source collaboration. Contributions are welcome.

1. Fork the repo
2. Create a feature branch — `git checkout -b feature/your-feature`
3. Commit your changes — `git commit -m 'add: your feature'`
4. Push and open a pull request

---

## Running into issues?

If you cloned this and hit a problem during setup or deployment, feel free to reach out:

- **Email** — nehemiaangana@icloud.com
- **GitHub Issues** — open an issue and tag it `help wanted`

Please include your OS and version, Python version (`python --version`), MongoDB version (`mongod --version`), and the full error message or relevant log output.

**Log locations:**
- Linux deploy log → `/var/log/order-system/deployment.log`
- Windows deploy log → `C:\ProgramData\order-system\logs\deployment.log`
- MongoDB → check the path set in your `mongod.conf` / `mongod.cfg`

---

## License

To be determined.

---

*Built with Flask + MongoDB · Runs on Linux and Windows · Deployed with a lot of Power*Shell*
