#!/usr/bin/env bash
# Order System Management Deployment (Debian/Ubuntu)
# Idempotent, menu-driven, best-effort (continues on errors), reuses env inputs.

set -u

APP_NAME="order-system"
INSTALL_DIR="/opt/${APP_NAME}"
ENV_DIR="/etc/${APP_NAME}"
ENV_FILE="${ENV_DIR}/${APP_NAME}.env"
LOG_DIR="/var/log/${APP_NAME}"
DEPLOY_LOG="${LOG_DIR}/deployment.log"

ADMIN_SERVICE="order-admin"
APP_SERVICE="order-app"

ADMIN_PY="admin_routes.py"
APP_PY="app.py"
REQ_FILE="requirements.txt"

DEFAULT_DB="dreamland_zero"
DEFAULT_APP_USER="dreamland"
DEFAULT_MONGO_HOST="localhost"
DEFAULT_MONGO_LOG="/var/log/mongodb/mongod.log"
DEFAULT_ADMIN_PORT="5002"
DEFAULT_ADMIN_USER="rootadmin"

# ---------------- helpers ----------------
ts() { date "+%Y-%m-%d %H:%M:%S"; }

sudo_maybe() { if [[ "$(id -u)" -ne 0 ]]; then sudo "$@"; else "$@"; fi; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

ensure_dirs() {
  sudo_maybe mkdir -p "$LOG_DIR" "$ENV_DIR" || true
  sudo_maybe touch "$DEPLOY_LOG" || true
}

log() { ensure_dirs; echo "[$(ts)] $*" | sudo_maybe tee -a "$DEPLOY_LOG" >/dev/null || true; }
info(){ echo "[*] $*"; log "[*] $*"; }
ok(){ echo "[+] $*"; log "[+] $*"; }
warn(){ echo "[!] $*"; log "[!] $*"; }
err(){ echo "[x] $*"; log "[x] $*"; }

run_step() {
  local title="$1"; shift
  info "$title"
  if "$@"; then ok "$title: done"; return 0
  else local rc=$?; err "$title: failed (rc=$rc) -> continuing"; return $rc
  fi
}

prompt_default() { local __out="$1" __p="$2" __d="$3"; local v; read -r -p "${__p} [${__d}]: " v; v="${v:-$__d}"; printf -v "$__out" "%s" "$v"; }
prompt_secret()  { local __out="$1" __p="$2"; local v; read -r -s -p "${__p}: " v; echo; printf -v "$__out" "%s" "$v"; }

detect_debian_like() {
  [[ -f /etc/os-release ]] || return 1
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID_LIKE:-}" == *debian* || "${ID:-}" == "debian" || "${ID:-}" == "ubuntu" ]] || return 1
  return 0
}

# ---------------- env reuse ----------------
load_env_defaults() {
  if sudo_maybe test -f "$ENV_FILE"; then
    # shellcheck disable=SC2046
    eval "$(sudo_maybe awk -F= '
      /^[A-Za-z_][A-Za-z0-9_]*=/ {
        key=$1; $1=""; sub(/^=/,""); val=$0;
        gsub(/'\''/,"'\\''\\''",val);
        printf("export %s='\''%s'\''\n", key, val);
      }' "$ENV_FILE")" || true
  fi
}

# ---------------- step 1: python ----------------
step_python_check_install() {
  detect_debian_like || { err "Only Debian/Ubuntu-like systems supported."; return 1; }
  if need_cmd python3; then ok "python3 already installed: $(python3 --version 2>/dev/null || true)"; return 0; fi
  warn "python3 not found."
  read -r -p "Install Python3 now? [Y/n]: " ans; ans="${ans:-Y}"
  [[ "$ans" =~ ^[Yy]$ ]] || { warn "Skipping Python install."; return 0; }
  run_step "apt update" sudo_maybe apt-get update -y
  run_step "install python3 + venv + pip" sudo_maybe apt-get install -y python3 python3-venv python3-pip
}

# ---------------- step 2: mongodb install ----------------
add_mongodb_repo() {
  detect_debian_like || return 1
  # shellcheck disable=SC1091
  . /etc/os-release
  local series="7.0"
  run_step "install curl gnupg ca-certificates" sudo_maybe apt-get install -y curl gnupg ca-certificates
  run_step "create keyring dir" sudo_maybe install -d -m 0755 /etc/apt/keyrings
  run_step "fetch MongoDB GPG key" bash -c "curl -fsSL https://pgp.mongodb.com/server-${series}.asc | sudo gpg --dearmor -o /etc/apt/keyrings/mongodb-server-${series}.gpg"
  local codename="${VERSION_CODENAME:-}"
  [[ -n "$codename" ]] || { err "No VERSION_CODENAME detected."; return 1; }
  local list_file="/etc/apt/sources.list.d/mongodb-org-${series}.list"
  local repo_line="deb [ signed-by=/etc/apt/keyrings/mongodb-server-${series}.gpg ] https://repo.mongodb.org/apt/${ID} ${codename}/mongodb-org/${series} multiverse"
  run_step "write MongoDB repo list" bash -c "echo '$repo_line' | sudo tee '$list_file' >/dev/null"
  run_step "apt update (with MongoDB repo)" sudo_maybe apt-get update -y
}

step_mongo_install() {
  if need_cmd mongod; then ok "mongod already installed: $(mongod --version 2>/dev/null | head -1 || true)"; return 0; fi
  warn "MongoDB not installed."
  read -r -p "Install MongoDB now? [Y/n]: " ans; ans="${ans:-Y}"
  [[ "$ans" =~ ^[Yy]$ ]] || { warn "Skipping MongoDB install."; return 0; }
  run_step "add MongoDB repo" add_mongodb_repo
  run_step "install mongodb-org" sudo_maybe apt-get install -y mongodb-org
}

# ---------------- mongo utilities ----------------
mongo_shell() { need_cmd mongosh && { echo mongosh; return; }; need_cmd mongo && { echo mongo; return; }; return 1; }

mongo_eval() {
  local host="localhost" user="" pass="" authdb=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --host) host="$2"; shift 2;;
      --user) user="$2"; shift 2;;
      --pass) pass="$2"; shift 2;;
      --authdb) authdb="$2"; shift 2;;
      *) break;;
    esac
  done
  local js="$1"
  local sh; sh="$(mongo_shell)" || { err "No mongosh/mongo installed"; return 127; }
  if [[ "$sh" == "mongosh" ]]; then
    local args=(--quiet "mongodb://${host}/")
    [[ -n "$user" ]] && args+=(--username "$user" --password "$pass" --authenticationDatabase "$authdb")
    "$sh" "${args[@]}" --eval "$js"
  else
    local args=(--quiet --host "$host")
    [[ -n "$user" ]] && args+=(-u "$user" -p "$pass" --authenticationDatabase "$authdb")
    "$sh" "${args[@]}" --eval "$js"
  fi
}

mongo_reachable() {
  mongo_eval --host "$1" "db.runCommand({ping:1})" >/dev/null 2>&1
}

mongo_auth_required() {
  local out rc
  out="$(mongo_eval --host "$1" "db.adminCommand({listDatabases:1})" 2>&1)"; rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "$out" | grep -Eqi "(Unauthorized|requires authentication|not authorized|Authentication failed)" && return 0
    return 2
  fi
  return 1
}

# ---------------- mongod.conf management ----------------
MONGOD_CONF=""
resolve_mongod_conf() {
  if sudo_maybe test -f "/etc/mongod.conf"; then
    MONGOD_CONF="/etc/mongod.conf"
  elif sudo_maybe test -f "/etc/mongodb/mongod.conf"; then
    MONGOD_CONF="/etc/mongodb/mongod.conf"
  else
    MONGOD_CONF="/etc/mongodb/mongod.conf"
  fi
}

conf_has_auth_enabled() {
  resolve_mongod_conf
  sudo_maybe test -f "$MONGOD_CONF" || return 1
  sudo_maybe grep -Eq 'authorization:\s*enabled' "$MONGOD_CONF"
}

conf_get_bindip() {
  resolve_mongod_conf
  sudo_maybe test -f "$MONGOD_CONF" || { echo ""; return 0; }
  sudo_maybe awk '
    $1=="net:" {in_net=1; next}
    in_net && $1 ~ /^bindIp:/ {print $2; exit}
    in_net && /^[^[:space:]]/ {in_net=0}
  ' "$MONGOD_CONF" 2>/dev/null || true
}

conf_is_fully_configured() {
  conf_has_auth_enabled || return 1
  local bind; bind="$(conf_get_bindip)"
  [[ -n "$bind" ]] || return 1
  return 0
}

create_mongod_conf() {
  resolve_mongod_conf
  local conf="$MONGOD_CONF"
  local conf_dir; conf_dir="$(dirname "$conf")"

  run_step "ensure conf directory $conf_dir" sudo_maybe mkdir -p "$conf_dir"

  if sudo_maybe test -f "$conf"; then
    run_step "backup existing mongod.conf" sudo_maybe cp -a "$conf" "${conf}.bak.$(date +%s)"
  fi

  # Fix ownership of data/log/pid dirs to the real running user — no mongodb system user assumed
  local real_user="${SUDO_USER:-$(whoami)}"
  run_step "ensure /run/mongod dir" sudo_maybe mkdir -p /run/mongod
  sudo_maybe chown "${real_user}:${real_user}" /run/mongod 2>/dev/null || \
    warn "Could not chown /run/mongod to ${real_user}"
  run_step "chown /var/lib/mongodb to ${real_user}" \
    sudo_maybe chown -R "${real_user}:${real_user}" /var/lib/mongodb
  run_step "chown /var/log/mongodb to ${real_user}" \
    sudo_maybe chown -R "${real_user}:${real_user}" /var/log/mongodb

  info "Writing mongod.conf to $conf (fork=false, auth=enabled, bindIp=0.0.0.0)..."
  sudo_maybe bash -c "cat > '$conf' <<'MONGODCONF'
# mongod.conf — generated by order-system deploy script

systemLog:
  destination: file
  path: /var/log/mongodb/mongod.log
  logAppend: true
  verbosity: 1

storage:
  dbPath: /var/lib/mongodb
  journal:
    enabled: true

net:
  bindIp: 0.0.0.0
  port: 27017

processManagement:
  fork: false
  pidFilePath: /run/mongod/mongod.pid
  timeZoneInfo: /usr/share/zoneinfo

security:
  authorization: enabled
MONGODCONF"
  local rc=$?
  [[ $rc -eq 0 ]] && ok "mongod.conf written: $conf" || { err "Failed to write mongod.conf (rc=$rc)"; return $rc; }
}

# ---------------- step 3: mongod conf + unit file + enable + test ----------------
MONGOD_UNIT="/etc/systemd/system/mongod.service"

mongod_unit_exists() {
  sudo_maybe test -f "$MONGOD_UNIT"
}

write_mongod_unit() {
  local real_user="${SUDO_USER:-$(whoami)}"
  local real_group; real_group="$(id -gn "$real_user" 2>/dev/null || echo "$real_user")"

  # Detect wrapper vs direct binary
  local exec_start
  if sudo_maybe test -f "/usr/local/bin/mongod-wrapper.sh"; then
    exec_start="/usr/local/bin/mongod-wrapper.sh --config ${MONGOD_CONF}"
    info "Wrapper detected at /usr/local/bin/mongod-wrapper.sh — using it in unit."
  else
    exec_start="/usr/bin/mongod --config ${MONGOD_CONF}"
  fi

  local tmp="/tmp/mongod.service.$$"
  cat > "$tmp" <<EOF
[Unit]
Description=MongoDB Database Server
After=network.target

[Service]
Type=simple
User=${real_user}
Group=${real_group}
ExecStart=${exec_start}
PIDFile=/run/mongod/mongod.pid
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  if mongod_unit_exists; then
    if sudo_maybe diff -q "$tmp" "$MONGOD_UNIT" >/dev/null 2>&1; then
      ok "mongod.service already up-to-date."
      rm -f "$tmp"; return 0
    fi
    run_step "backup existing mongod.service" sudo_maybe cp -a "$MONGOD_UNIT" "${MONGOD_UNIT}.bak.$(date +%s)" || true
  fi

  run_step "install mongod.service" sudo_maybe install -m 0644 "$tmp" "$MONGOD_UNIT"
  rm -f "$tmp"
}

step_mongod_unit_conf() {
  need_cmd mongod || { err "MongoDB not installed — run Step 2 first."; return 1; }
  resolve_mongod_conf

  # --- conf ---
  if conf_is_fully_configured; then
    ok "mongod.conf already configured: $MONGOD_CONF"
  else
    warn "mongod.conf missing or incomplete — creating."
    create_mongod_conf || return 1
  fi

  # --- unit file ---
  if mongod_unit_exists; then
    ok "mongod.service already exists: $MONGOD_UNIT"
    # Still check User= matches current user in case it changed
    local real_user="${SUDO_USER:-$(whoami)}"
    if ! sudo_maybe grep -q "User=${real_user}" "$MONGOD_UNIT"; then
      warn "mongod.service User= does not match ${real_user} — updating unit."
      write_mongod_unit || return 1
    fi
  else
    info "mongod.service not found — creating."
    write_mongod_unit || return 1
  fi

  run_step "daemon-reload" sudo_maybe systemctl daemon-reload

  # --- enable ---
  run_step "enable mongod" sudo_maybe systemctl enable mongod

  # --- test start/stop/restart ---
  info "Testing mongod start..."
  sudo_maybe systemctl start mongod
  sleep 2
  if sudo_maybe systemctl is-active --quiet mongod; then
    ok "mongod started successfully."
  else
    err "mongod failed to start — check: journalctl -u mongod -n 30"
    sudo_maybe systemctl --no-pager -l status mongod | head -20 || true
    return 1
  fi

  info "Testing mongod stop..."
  sudo_maybe systemctl stop mongod
  sleep 1
  ok "mongod stopped."

  info "Testing mongod restart..."
  sudo_maybe systemctl restart mongod
  sleep 2
  if sudo_maybe systemctl is-active --quiet mongod; then
    ok "mongod restart OK — service is running."
  else
    err "mongod failed after restart."
    sudo_maybe systemctl --no-pager -l status mongod | head -20 || true
    return 1
  fi
}

# ---------------- step 4: mongo users + seed ----------------
step_mongo_config_users_seed() {
  load_env_defaults

  local is_local="Y"
  read -r -p "Is MongoDB on THIS host? [Y/n]: " is_local; is_local="${is_local:-Y}"

  local host="${MONGO_HOST:-$DEFAULT_MONGO_HOST}"
  prompt_default host "Mongo host" "$host"

  info "Checking Mongo reachability on $host..."
  if ! mongo_reachable "$host"; then
    err "Mongo is NOT reachable on $host. Ensure Step 3 completed and mongod is running."
    return 1
  fi
  ok "Mongo reachable on $host"

  local auth_required
  if mongo_auth_required "$host"; then
    auth_required="yes"
  else
    local _rc=$?
    [[ $_rc -eq 1 ]] && auth_required="no" || auth_required="unknown"
  fi

  # ── PATH A: Auth enforced — verify admin, ensure app user exists ──────────
  if [[ "$auth_required" == "yes" ]]; then
    ok "Auth is enforced — MongoDB already configured."
    echo
    info "Verifying admin and ensuring app user exists:"
    echo

    local APP_DB="${MONGO_DB:-$DEFAULT_DB}"
    local APP_USER="${MONGO_USER:-$DEFAULT_APP_USER}"
    local APP_PASS=""
    local ADMIN_USER="${ADMIN_MONGO_USER:-$DEFAULT_ADMIN_USER}"
    local ADMIN_PASS=""

    prompt_default ADMIN_USER "Admin Mongo username" "$ADMIN_USER"
    prompt_secret  ADMIN_PASS "Admin Mongo password (for $ADMIN_USER)"

    info "Testing admin login..."
    if ! mongo_eval --host "$host" --user "$ADMIN_USER" --pass "$ADMIN_PASS" --authdb "admin" \
         "db.runCommand({ping:1})" >/dev/null 2>&1; then
      err "Admin auth FAILED — wrong username or password."
      return 1
    fi
    ok "Admin verified."

    prompt_default APP_DB   "App database"      "$APP_DB"
    prompt_default APP_USER "App Mongo username" "$APP_USER"
    prompt_secret  APP_PASS "App Mongo password (for $APP_USER)"

    info "Checking if app user '$APP_USER' exists on '$APP_DB'..."
    local user_exists
    user_exists=$(mongo_eval --host "$host" --user "$ADMIN_USER" --pass "$ADMIN_PASS" --authdb "admin" "
      const adb = db.getSiblingDB('${APP_DB}');
      print(adb.getUser('${APP_USER}') ? 'yes' : 'no');
    " 2>/dev/null | grep -E '^(yes|no)$' | tail -1)

    if [[ "$user_exists" == "yes" ]]; then
      info "User '$APP_USER' already exists — verifying password..."
      if ! mongo_eval --host "$host" --user "$APP_USER" --pass "$APP_PASS" --authdb "$APP_DB" \
           "db.runCommand({ping:1})" >/dev/null 2>&1; then
        err "Password wrong for '$APP_USER' on '$APP_DB' — user exists but password incorrect."
        return 1
      fi
      ok "App user '$APP_USER' verified."
    else
      info "User '$APP_USER' not found — creating with provided password..."
      mongo_eval --host "$host" --user "$ADMIN_USER" --pass "$ADMIN_PASS" --authdb "admin" "
        const adb = db.getSiblingDB('${APP_DB}');
        adb.createUser({user: '${APP_USER}', pwd: '${APP_PASS}', roles: [{role: 'readWrite', db: '${APP_DB}'}]});
        print('app user created: ${APP_USER}');
      " 2>&1 | grep -v '^$' || { err "Failed to create app user '$APP_USER'."; return 1; }
      ok "App user '$APP_USER' created on '$APP_DB'."
    fi

    info "Seeding '$APP_DB'..."
    mongo_eval --host "$host" --user "$ADMIN_USER" --pass "$ADMIN_PASS" --authdb "admin" "
      db.getSiblingDB('${APP_DB}').getCollection('init').updateOne(
        {_id: 'seed'},
        {\$set: {createdAt: new Date(), note: 'seeded by deployment script'}},
        {upsert: true}
      );
    " >/dev/null 2>&1 || true

    run_step "cache credentials" sudo_maybe bash -c "cat > '${ENV_DIR}/.last_inputs' <<EOF
MONGO_HOST=${host}
MONGO_DB=${APP_DB}
MONGO_USER=${APP_USER}
MONGO_PASS=${APP_PASS}
ADMIN_MONGO_USER=${ADMIN_USER}
ADMIN_MONGO_PASS=${ADMIN_PASS}
ADMIN_PORT=${DEFAULT_ADMIN_PORT}
MONGO_LOG=${DEFAULT_MONGO_LOG}
EOF"
    sudo_maybe chmod 600 "${ENV_DIR}/.last_inputs" || true
    ok "Done. Run Step 5 to write the env file."
    return 0
  fi

  # ── PATH B: No auth — fresh install, create both admin and app user ───────
  warn "Mongo has no auth — fresh install. Creating admin and app user now."
  echo

  local APP_DB="${MONGO_DB:-$DEFAULT_DB}"
  local APP_USER="${MONGO_USER:-$DEFAULT_APP_USER}"
  local APP_PASS="${MONGO_PASS:-}"
  local ADMIN_USER="${ADMIN_MONGO_USER:-$DEFAULT_ADMIN_USER}"
  local ADMIN_PASS="${ADMIN_MONGO_PASS:-}"

  prompt_default APP_DB    "App database"             "$APP_DB"
  prompt_default APP_USER  "App Mongo username"       "$APP_USER"
  [[ -n "$APP_PASS" ]]   || prompt_secret APP_PASS    "App Mongo password (for $APP_USER)"
  prompt_default ADMIN_USER "Admin Mongo username"    "$ADMIN_USER"
  [[ -n "$ADMIN_PASS" ]] || prompt_secret ADMIN_PASS  "Admin Mongo password (for $ADMIN_USER)"

  info "Creating admin user '${ADMIN_USER}' (no-auth login)..."
  mongo_eval --host "$host" "
    const adm = db.getSiblingDB('admin');
    const u = '${ADMIN_USER}', p = '${ADMIN_PASS}';
    if (adm.getUser(u)) {
      print('admin already exists: ' + u);
    } else {
      adm.createUser({user: u, pwd: p, roles: [{role: 'root', db: 'admin'}]});
      print('admin created: ' + u);
    }
  " 2>&1 | grep -v '^$' || { err "Failed to create admin user."; return 1; }

  info "Creating app user '${APP_USER}' on '${APP_DB}'..."
  mongo_eval --host "$host" --user "$ADMIN_USER" --pass "$ADMIN_PASS" --authdb "admin" "
    const adb = db.getSiblingDB('${APP_DB}');
    const u = '${APP_USER}', p = '${APP_PASS}';
    if (adb.getUser(u)) {
      print('app user already exists: ' + u);
    } else {
      adb.createUser({user: u, pwd: p, roles: [{role: 'readWrite', db: '${APP_DB}'}]});
      print('app user created: ' + u);
    }
    adb.getCollection('init').updateOne(
      {_id: 'seed'},
      {\$set: {createdAt: new Date(), note: 'seeded by deployment script'}},
      {upsert: true}
    );
    print('DB seeded: ${APP_DB}');
  " 2>&1 | grep -v '^$' || { err "Failed to create app user on $APP_DB."; return 1; }

  info "Verifying admin login..."
  if ! mongo_eval --host "$host" --user "$ADMIN_USER" --pass "$ADMIN_PASS" --authdb "admin" \
       "db.runCommand({ping:1})" >/dev/null 2>&1; then
    err "Admin verify FAILED after creation. Check mongod logs."
    return 1
  fi
  ok "Admin verified."
  ok "App user '$APP_USER' created on '$APP_DB'."
  echo

  run_step "cache credentials" sudo_maybe bash -c "cat > '${ENV_DIR}/.last_inputs' <<EOF
MONGO_HOST=${host}
MONGO_DB=${APP_DB}
MONGO_USER=${APP_USER}
MONGO_PASS=${APP_PASS}
ADMIN_MONGO_USER=${ADMIN_USER}
ADMIN_MONGO_PASS=${ADMIN_PASS}
ADMIN_PORT=${DEFAULT_ADMIN_PORT}
MONGO_LOG=${DEFAULT_MONGO_LOG}
EOF"
  sudo_maybe chmod 600 "${ENV_DIR}/.last_inputs" || true
  ok "Done. Run Step 5 to write the env file."
}

# ---------------- step 5: env file ----------------
step_env_file() {
  load_env_defaults

  if sudo_maybe test -f "${ENV_DIR}/.last_inputs"; then
    # shellcheck disable=SC1090
    source <(sudo_maybe cat "${ENV_DIR}/.last_inputs") || true
  fi

  local host="${MONGO_HOST:-$DEFAULT_MONGO_HOST}"
  local dbn="${MONGO_DB:-$DEFAULT_DB}"
  local appu="${MONGO_USER:-$DEFAULT_APP_USER}"
  local appp="${MONGO_PASS:-}"
  local adu="${ADMIN_MONGO_USER:-$DEFAULT_ADMIN_USER}"
  local adp="${ADMIN_MONGO_PASS:-}"
  local aport="${ADMIN_PORT:-$DEFAULT_ADMIN_PORT}"
  local mlog="${MONGO_LOG:-$DEFAULT_MONGO_LOG}"

  echo
  info "Enter credentials for the env file (Enter to accept default):"
  echo
  prompt_default host  "Mongo host"       "$host"
  prompt_default dbn   "Mongo DB name"    "$dbn"
  prompt_default appu  "App Mongo user"   "$appu"
  prompt_secret  appp  "App Mongo pass (for $appu)"
  prompt_default adu   "Admin Mongo user" "$adu"
  prompt_secret  adp   "Admin Mongo pass (for $adu)"
  prompt_default aport "Admin port"       "$aport"
  prompt_default mlog  "Mongo log path"   "$mlog"

  run_step "write env file $ENV_FILE" sudo_maybe bash -c "cat > '$ENV_FILE' <<EOF
MONGO_USER=${appu}
MONGO_PASS=${appp}
MONGO_HOST=${host}
MONGO_DB=${dbn}
MONGO_LOG=${mlog}
ADMIN_PORT=${aport}
ADMIN_MONGO_USER=${adu}
ADMIN_MONGO_PASS=${adp}
EOF"

  run_step "lock down env file" sudo_maybe bash -c "
    chown root:root '$ENV_FILE'
    chmod 600 '$ENV_FILE'
  "

  ok "Env file ready: $ENV_FILE"
  echo "  Owner : $(sudo_maybe stat -c '%U:%G' "$ENV_FILE" 2>/dev/null || true)"
  echo "  Perms : $(sudo_maybe stat -c '%a' "$ENV_FILE" 2>/dev/null || true)"
  echo "  Edit  : sudo nano $ENV_FILE"
}

# ---------------- step 6: deploy app ----------------
copy_project() {
  sudo_maybe mkdir -p "$INSTALL_DIR" || return 1

  if need_cmd rsync; then
    sudo_maybe rsync -a --delete \
      --exclude ".git" --exclude ".venv" --exclude "__pycache__" --exclude "*.pyc" \
      "./" "$INSTALL_DIR/"
  else
    warn "rsync not found."
    read -r -p "Install rsync now? [Y/n]: " ans; ans="${ans:-Y}"
    if [[ "$ans" =~ ^[Yy]$ ]]; then
      run_step "apt update" sudo_maybe apt-get update -y
      run_step "install rsync" sudo_maybe apt-get install -y rsync
      if need_cmd rsync; then
        ok "rsync installed. Proceeding with rsync copy."
        sudo_maybe rsync -a --delete \
          --exclude ".git" --exclude ".venv" --exclude "__pycache__" --exclude "*.pyc" \
          "./" "$INSTALL_DIR/"
      else
        err "rsync install failed."
        read -r -p "Fall back to cp instead? [Y/n]: " cpans; cpans="${cpans:-Y}"
        if [[ "$cpans" =~ ^[Yy]$ ]]; then
          warn "Falling back to cp -a."
          sudo_maybe rm -rf "$INSTALL_DIR" || true
          sudo_maybe mkdir -p "$INSTALL_DIR" || return 1
          sudo_maybe cp -a ./* "$INSTALL_DIR/" 2>/dev/null || sudo_maybe cp -a . "$INSTALL_DIR/"
        else
          err "No copy method available. Aborting deploy."
          return 1
        fi
      fi
    else
      warn "rsync skipped by user."
      read -r -p "Fall back to cp instead? [Y/n]: " cpans; cpans="${cpans:-Y}"
      if [[ "$cpans" =~ ^[Yy]$ ]]; then
        warn "Falling back to cp -a."
        sudo_maybe rm -rf "$INSTALL_DIR" || true
        sudo_maybe mkdir -p "$INSTALL_DIR" || return 1
        sudo_maybe cp -a ./* "$INSTALL_DIR/" 2>/dev/null || sudo_maybe cp -a . "$INSTALL_DIR/"
      else
        err "No copy method available. Aborting deploy."
        return 1
      fi
    fi
  fi
}

step_deploy_app() {
  [[ -f "$APP_PY" ]]   || { err "Missing $APP_PY in repo root.";   return 1; }
  [[ -f "$ADMIN_PY" ]] || { err "Missing $ADMIN_PY in repo root."; return 1; }

  run_step "copy project to $INSTALL_DIR" copy_project || return 1
  run_step "create venv" sudo_maybe bash -c "cd '$INSTALL_DIR' && python3 -m venv .venv"

  if [[ -f "$REQ_FILE" ]]; then
    run_step "install deps" sudo_maybe bash -c "cd '$INSTALL_DIR' && .venv/bin/pip install --upgrade pip && .venv/bin/pip install -r '$REQ_FILE'"
  else
    warn "No requirements.txt; skipping pip installs."
  fi

  ok "App deployed to $INSTALL_DIR"
}

# ---------------- step 7: app systemd units ----------------
unit_path(){ echo "/etc/systemd/system/$1.service"; }

write_unit_if_changed() {
  local name="$1" script="$2" outlog="$3" errlog="$4"
  local path; path="$(unit_path "$name")"
  local tmp="/tmp/${name}.service.$$"

  cat > "$tmp" <<EOF
[Unit]
Description=${APP_NAME} - ${name}
After=network.target mongod.service
Wants=mongod.service

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${INSTALL_DIR}/.venv/bin/python ${INSTALL_DIR}/${script}
Restart=always
RestartSec=2
StandardOutput=append:${outlog}
StandardError=append:${errlog}

[Install]
WantedBy=multi-user.target
EOF

  if sudo_maybe test -f "$path"; then
    if sudo_maybe diff -q "$tmp" "$path" >/dev/null 2>&1; then
      ok "$name unit already up-to-date."
      rm -f "$tmp"; return 0
    fi
    run_step "backup existing unit $name" sudo_maybe cp -a "$path" "${path}.bak.$(date +%s)" || true
  fi

  run_step "install unit $name" sudo_maybe install -m 0644 "$tmp" "$path"
  rm -f "$tmp"
}

step_systemd_services() {
  if ! sudo_maybe test -f "$ENV_FILE"; then
    err "Env file missing: $ENV_FILE — run Step 5 first."
    return 1
  fi
  sudo_maybe mkdir -p "$LOG_DIR" || true
  sudo_maybe touch "$LOG_DIR/app.log" "$LOG_DIR/app.err" "$LOG_DIR/admin.log" "$LOG_DIR/admin.err" || true
  sudo_maybe chmod 644 "$LOG_DIR/"*.log "$LOG_DIR/"*.err || true

  run_step "write/update ${ADMIN_SERVICE}.service" write_unit_if_changed "$ADMIN_SERVICE" "$ADMIN_PY" "$LOG_DIR/admin.log" "$LOG_DIR/admin.err"
  run_step "write/update ${APP_SERVICE}.service"   write_unit_if_changed "$APP_SERVICE"   "$APP_PY"   "$LOG_DIR/app.log"   "$LOG_DIR/app.err"

  run_step "daemon-reload"   sudo_maybe systemctl daemon-reload
  run_step "enable services" sudo_maybe systemctl enable "${ADMIN_SERVICE}.service" "${APP_SERVICE}.service"
}

# ---------------- step 8: start app services ----------------
step_start_services() {
  if ! sudo_maybe test -f "$(unit_path "$ADMIN_SERVICE")" || \
     ! sudo_maybe test -f "$(unit_path "$APP_SERVICE")"; then
    err "App unit files missing. Run Step 7 first."
    return 1
  fi
  run_step "restart ${ADMIN_SERVICE}" sudo_maybe systemctl restart "${ADMIN_SERVICE}.service"
  run_step "restart ${APP_SERVICE}"   sudo_maybe systemctl restart "${APP_SERVICE}.service"
  echo
  echo "Logs:"
  echo "  journalctl -u ${ADMIN_SERVICE} -f"
  echo "  journalctl -u ${APP_SERVICE}  -f"
  echo "  tail -f ${LOG_DIR}/admin.log"
  echo "  tail -f ${LOG_DIR}/app.log"
}

# ---------------- status ----------------
step_status() {
  load_env_defaults
  echo "=== STATUS ==="
  need_cmd python3 && echo "Python : OK ($(python3 --version 2>/dev/null))" || echo "Python : MISSING"
  need_cmd mongod  && echo "Mongod : installed" || echo "Mongod : missing"
  if [[ -n "${MONGO_HOST:-}" ]]; then
    mongo_reachable "$MONGO_HOST" \
      && echo "Mongo  : reachable ($MONGO_HOST)" \
      || echo "Mongo  : NOT reachable ($MONGO_HOST)"
  fi
  echo
  sudo_maybe systemctl --no-pager -l status mongod                     2>/dev/null | head -10 || true
  sudo_maybe systemctl --no-pager -l status "${ADMIN_SERVICE}.service" 2>/dev/null | head -10 || true
  sudo_maybe systemctl --no-pager -l status "${APP_SERVICE}.service"   2>/dev/null | head -10 || true
  echo
  (ss -lntp 2>/dev/null || true) | grep -E ':(5001|5002)\b' || echo "No listeners on 5001/5002."
}

# ---------------- full auto deploy ----------------
step_full_deploy() {
  echo
  info "=== FULL AUTO DEPLOY ==="
  info "Skips any step that is already completed."
  echo

  # Step 1: Python
  step_python_check_install

  # Step 2: MongoDB
  step_mongo_install

  # Step 3: mongod conf + unit + enable + test
  # Skip entirely if conf is already done AND unit exists AND service is active
  if conf_is_fully_configured && mongod_unit_exists && sudo_maybe systemctl is-active --quiet mongod; then
    ok "Step 3 skipped — mongod conf, unit, and service already OK."
  else
    step_mongod_unit_conf
  fi

  # Step 4: Users + seed
  # This is interactive by nature — always runs but internal logic skips if users exist
  step_mongo_config_users_seed

  # Step 5: Env file
  step_env_file

  # Step 6: Deploy app
  step_deploy_app

  # Step 7: App unit files
  step_systemd_services

  # Step 8: Start services
  step_start_services

  step_status
}

menu() {
  clear || true
  cat <<'EOF'
╔══════════════════════════════════════════════════════╗
║     ORDER SYSTEM MANAGEMENT (IaC Deploy + Logs)      ║
╚══════════════════════════════════════════════════════╝
EOF
  echo "1) Check/Install Python3"
  echo "2) Check/Install MongoDB"
  echo "3) mongod: conf + systemd unit + enable + test start/stop/restart"
  echo "4) Mongo: users + seed (requires Step 3)"
  echo "5) Create/Update Environment File (root-owned, 600)"
  echo "6) Deploy App to /opt (rsync + venv + deps)"
  echo "7) Create/Update App Systemd Units"
  echo "8) Start/Restart App Services"
  echo "9) Status Summary"
  echo "0) Full Auto Deploy (1→2→3→4→5→6→7→8)"
  echo "q) Exit"
  echo
}

main() {
  detect_debian_like || { echo "[x] Debian/Ubuntu-like only."; exit 1; }
  ensure_dirs
  while true; do
    menu
    read -r -p "Select option: " c
    case "${c:-}" in
      1) step_python_check_install ;;
      2) step_mongo_install ;;
      3) step_mongod_unit_conf ;;
      4) step_mongo_config_users_seed ;;
      5) step_env_file ;;
      6) step_deploy_app ;;
      7) step_systemd_services ;;
      8) step_start_services ;;
      9) step_status ;;
      0) step_full_deploy ;;
      q|Q) exit 0 ;;
      *) echo "Invalid." ;;
    esac
    echo
    read -r -p "Press Enter..." _
  done
}

main "$@"
