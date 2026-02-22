#!/usr/bin/env python3
"""
admin_server.py — Dreamland Admin Server
Standalone process: REST API + WebSocket MongoDB monitor + Admin UI
Port: 5001
"""

import os
import re
import glob
import json
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from collections import deque
import secrets
from flask import Flask, render_template, session, redirect, url_for, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from pymongo import MongoClient
from pymongo.errors import OperationFailure
from bson import ObjectId
from bson.json_util import dumps as bson_dumps
from werkzeug.security import check_password_hash
import pytz
import platform

# ============================================================================
# CONFIG
# ============================================================================
class Config:
    MONGO_USER   = os.environ.get('MONGO_USER')
    MONGO_PASS   = os.environ.get('MONGO_PASS')
    MONGO_HOST   = os.environ.get('MONGO_HOST', 'localhost')
    DB_NAME      = os.environ.get('MONGO_DB',   'dreamland_zero')
    LOG_PATH     = os.environ.get('MONGO_LOG',  '/var/log/mongodb/mongod.log')
    ADMIN_PORT   = int(os.environ.get('ADMIN_PORT', 5002))
    CONNECTION_TIMEOUT = 3000
    ADMIN_MONGO_USER = os.environ.get('ADMIN_MONGO_USER')
    ADMIN_MONGO_PASS = os.environ.get('ADMIN_MONGO_PASS')
    # Work app backup paths — same root dir as both apps
    BACKUP_LOG  = os.environ.get('BACKUP_LOG',  'logs/backup.log')
    BACKUP_DIR  = os.environ.get('BACKUP_DIR',  'backup')
    BACKUP_HOUR = int(os.environ.get('BACKUP_HOUR', 20))  # 20:00 Nairobi daily

    @classmethod
    def get_uri(cls, host=None):
        h    = host or cls.MONGO_HOST
        auth = f"{cls.MONGO_USER}:{cls.MONGO_PASS}@" if cls.MONGO_USER else ""
        return f"mongodb://{auth}{h}:27017/{cls.DB_NAME}?authSource={cls.DB_NAME}&serverSelectionTimeoutMS={cls.CONNECTION_TIMEOUT}"

    @classmethod
    def get_admin_uri(cls, host=None):
        h    = host or cls.MONGO_HOST
        auth = f"{cls.ADMIN_MONGO_USER}:{cls.ADMIN_MONGO_PASS}@" if cls.ADMIN_MONGO_USER else ""
        return f"mongodb://{auth}{h}:27017/admin?authSource=admin&serverSelectionTimeoutMS={cls.CONNECTION_TIMEOUT}"

# Resolve URIs after class is fully defined
MONGO_URI       = Config.get_uri()
MONGO_ADMIN_URI = Config.get_admin_uri()
MONGO_DB        = Config.DB_NAME
MONGO_ADMIN     = 'admin'
ADMIN_PORT      = Config.ADMIN_PORT
LOG_PATH        = Config.LOG_PATH

NAIROBI_TZ = pytz.timezone('Africa/Nairobi')
UTC = pytz.utc

# ============================================================================
# FLASK APP
# ============================================================================
app = Flask(__name__, template_folder='templates', static_folder='static')
app.config['SECRET_KEY']          = secrets.token_hex(32)
app.config['SESSION_COOKIE_NAME'] = 'dreamland_admin'
CORS(app, supports_credentials=True)
socketio = SocketIO(
    app,
    cors_allowed_origins='*',
    async_mode='threading',
    logger=False,
    engineio_logger=False,
    ping_timeout=60,
    ping_interval=25
)

# ============================================================================
# MONGODB CONNECTION
# ============================================================================
mongo_client     = MongoClient(MONGO_URI)
db               = mongo_client[MONGO_DB]
users_collection = db['users']
logs_collection  = db['session_logs']

# Admin-privileged client (authSource=admin)
admin_client = MongoClient(MONGO_ADMIN_URI)
admin_db     = admin_client[MONGO_ADMIN]


# Persistent collections for DB monitor history
db_auth_logs      = db['db_auth_logs']
db_lifecycle_logs = db['db_lifecycle_logs']
db_auth_logs.create_index([('timestamp', -1)])
db_lifecycle_logs.create_index([('timestamp', -1)])


# ============================================================================
# SERVER INFO HELPER — called on every ws_connect
# ============================================================================
def to_eat(dt):
    if dt is None:
        return None
    if dt.tzinfo is None:
        return UTC.localize(dt).astimezone(NAIROBI_TZ)
    return dt.astimezone(NAIROBI_TZ)

def parse_backup_log():
    """Read work app backup.log, find last backup result."""
    log_path = Path(Config.BACKUP_LOG)
    if not log_path.exists():
        return {'status': 'unknown', 'timestamp': None, 'filename': None, 'error': 'log not found'}

    last_success = None
    last_failure = None
    try:
        with open(log_path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                m = re.search(r'Local backup successful: (dump_[\w]+\.json)', line)
                if m:
                    ts_match = re.match(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
                    ts = ts_match.group(1) if ts_match else None
                    last_success = {'filename': m.group(1), 'timestamp': ts}
                m2 = re.search(r'Backup failed: (.+)', line)
                if m2:
                    ts_match = re.match(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
                    ts = ts_match.group(1) if ts_match else None
                    last_failure = {'error': m2.group(1), 'timestamp': ts}
    except Exception as e:
        return {'status': 'error', 'timestamp': None, 'filename': None, 'error': str(e)}

    if last_success and last_failure:
        if (last_failure['timestamp'] or '') > (last_success['timestamp'] or ''):
            return {'status': 'failed', 'timestamp': last_failure['timestamp'],
                    'filename': None, 'error': last_failure['error']}
    if last_success:
        return {'status': 'success', 'timestamp': last_success['timestamp'],
                'filename': last_success['filename'], 'error': None}
    if last_failure:
        return {'status': 'failed', 'timestamp': last_failure['timestamp'],
                'filename': None, 'error': last_failure['error']}
    return {'status': 'unknown', 'timestamp': None, 'filename': None, 'error': None}


def get_backup_dir_info():
    """Scan backup/ folder — count dumps, latest size, total size."""
    backup_dir = Path(Config.BACKUP_DIR)
    if not backup_dir.exists():
        return {'count': 0, 'latest_size_mb': None, 'total_size_mb': None, 'latest_file': None}
    files = sorted(backup_dir.glob('dump_*.json'), key=lambda f: f.stat().st_mtime, reverse=True)
    if not files:
        return {'count': 0, 'latest_size_mb': None, 'total_size_mb': None, 'latest_file': None}
    total_bytes  = sum(f.stat().st_size for f in files)
    latest_bytes = files[0].stat().st_size
    return {
        'count':          len(files),
        'latest_file':    files[0].name,
        'latest_size_mb': round(latest_bytes / 1024 / 1024, 2),
        'total_size_mb':  round(total_bytes  / 1024 / 1024, 2),
    }


def get_mongo_log_info():
    """Return MongoDB log file size in MB."""
    log_path = Path(Config.LOG_PATH)
    if not log_path.exists():
        return {'size_mb': None, 'path': Config.LOG_PATH}
    return {
        'size_mb': round(log_path.stat().st_size / 1024 / 1024, 2),
        'path':    Config.LOG_PATH
    }


def get_server_info():
    """
    Bundle serverStatus + backup info + log info.
    Called on every ws_connect — auto-populates cards on connect/reconnect.
    """
    info = {
        'mem':         {},
        'backup':      {},
        'backup_dir':  {},
        'log':         {},
        'next_backup': f"{Config.BACKUP_HOUR:02d}:00",
    }
    try:
        status = admin_db.command('serverStatus')
        mem    = status.get('mem', {})
        info['mem'] = {
            'resident_mb': mem.get('resident'),
            'virtual_mb':  mem.get('virtual'),
            'mapped_mb':   mem.get('mapped'),
        }
        info['uptime_sec']  = status.get('uptimeMillis', 0) // 1000
        info['version']     = status.get('version')
        info['connections'] = status.get('connections', {})
    except Exception as e:
        info['mem_error'] = str(e)

    info['backup']     = parse_backup_log()
    info['backup_dir'] = get_backup_dir_info()
    info['log']        = get_mongo_log_info()
    return info

def tz_now():
    return datetime.now(NAIROBI_TZ)
# ============================================================================
# SERIALIZERS
# ============================================================================

def serialize_user(u):
    return {
        'id':         str(u['_id']),
        'email':      u.get('email', ''),
        'first_name': u.get('first_name', ''),
        'last_name':  u.get('last_name', ''),
        'phone':      u.get('phone', ''),
        'role':       u.get('role', 'user'),
        'status':     u.get('status', 'pending'),
        'created_at': u['created_at'].strftime('%Y-%m-%d %H:%M') if u.get('created_at') else '—',
        'last_login': u['last_login'].strftime('%Y-%m-%d %H:%M') if u.get('last_login') else 'Never',
    }

def serialize_log(l):
    ts = l.get('timestamp') or l.get('detected_at')
    if isinstance(ts, str):
        ts_str = ts
    elif ts:
        try:
            ts_str = ts.strftime('%Y-%m-%d %H:%M:%S')
        except Exception:
            ts_str = str(ts)
    else:
        ts_str = '—'

    return {
        'action':     l.get('action', '—'),
        'reason':     l.get('reason', '—'),
        'timestamp':  ts_str,
        'ip_address': l.get('ip_address', '—'),
        'user_agent': l.get('user_agent', '—'),
        'email':      l.get('email', '—'),
    }

# ============================================================================
# ADMIN AUTH — separate from app users
# ============================================================================

def admin_required(f):
    from functools import wraps
    @wraps(f)
    def decorated(*args, **kwargs):
        if 'admin' not in session:
            return jsonify({"status": "error", "error": "Unauthorized"}), 401
        return f(*args, **kwargs)
    return decorated

@app.route('/admin/login', methods=['GET'])
def admin_login_page():
    if 'admin' in session:
        return redirect('/admin')
    return render_template('admin_login.html')

@app.route('/admin/login', methods=['POST'])
def admin_login():
    data     = request.get_json()
    email    = data.get('email', '').strip()
    password = data.get('password', '')

    user = users_collection.find_one({'email': email, 'role': {'$in': ['admin', 'manager']}})
    if not user or not check_password_hash(user['password'], password):
        return jsonify({"status": "error", "error": "Invalid credentials"}), 401

    if user.get('status') != 'active':
        return jsonify({"status": "error", "error": "Account not active"}), 403

    session['admin'] = {
        'email':      user['email'],
        'name':       f"{user.get('first_name','')} {user.get('last_name','')}",
        'role':       user['role'],
        'user_id':    str(user['_id'])
    }
    session.permanent = True

    return jsonify({"status": "success", "redirect": "/admin"}), 200

@app.route('/admin/logout')
def admin_logout():
    session.pop('admin', None)
    return redirect('/admin/login')

@app.route('/admin')
def admin_panel():
    if 'admin' not in session:
        return redirect('/admin/login')
    return render_template('admin.html')

# ============================================================================
# API: STATS
# ============================================================================
@app.route('/api/admin/stats')
@admin_required
def get_stats():
    try:
        now = tz_now()
        today_start_eat = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_start_utc = today_start_eat.astimezone(pytz.utc)

        total   = users_collection.count_documents({})
        pending = users_collection.count_documents({'status': 'pending'})
        blocked = users_collection.count_documents({'status': 'blocked'})

        active_sess = len(logs_collection.distinct('email', {
            'action': 'login_success',
            'timestamp': {'$gte': today_start_utc}
        }))

        failed_today = logs_collection.count_documents({
            'action': 'login_failed',
            'timestamp': {'$gte': today_start_utc}
        })

        return jsonify({"status": "success", "data": {
            "total_users":         total,
            "active_sessions":     active_sess,
            "pending_users":       pending,
            "blocked_users":       blocked,
            "failed_attempts_24h": failed_today
        }}), 200

    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

# ============================================================================
# API: USERS
# ============================================================================
@app.route('/api/admin/users')
@admin_required
def get_users():
    try:
        q      = request.args.get('q', '').strip()
        status = request.args.get('status', '').strip()
        query  = {}
        if q:
            query = {"$or": [
                {"email":      {"$regex": q, "$options": "i"}},
                {"first_name": {"$regex": q, "$options": "i"}},
                {"last_name":  {"$regex": q, "$options": "i"}},
            ]}
        if status and status != 'all':
            if status == 'approved':
                query['status'] = 'active'  # approved = active in DB
            else:
                query['status'] = status

        users = list(users_collection.find(query, {"password": 0, "login_history": 0}))

        # Get today's active emails from session_logs
        now = tz_now()
        today_start_utc = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(pytz.utc)
        logged_in_today = set(logs_collection.distinct('email', {
            'action': 'login_success',
            'timestamp': {'$gte': today_start_utc}
        }))

        serialized = []
        for u in users:
            user_data = serialize_user(u)
            if u.get('status') == 'active':
                user_data['display_status'] = 'active' if u.get('email') in logged_in_today else 'approved'
            else:
                user_data['display_status'] = u.get('status')
            serialized.append(user_data)

        return jsonify({"status": "success", "data": serialized}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

# ============================================================
# KICK ALL USERS — triggers global force logout via lock file
# Call this from your admin server
# ============================================================
@app.route('/api/admin/kick-all-users', methods=['POST'])
@admin_required
def kick_all_users():
    try:
        trigger_force_logout()  # Creates the lock file
        db['session_logs'].insert_one({
            'action': 'global_force_logout',
            'reason': 'admin_triggered_all',
            'timestamp': datetime.now(NAIROBI_TZ),
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent')
        })
        return jsonify({'status': 'success', 'message': 'All users will be logged out on next request'}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/api/admin/clear-kick-all', methods=['POST'])
@admin_required
def clear_kick_all():
    """Clear the global force logout flag so new logins are allowed again"""
    try:
        clear_force_logout()
        return jsonify({'status': 'success', 'message': 'Global logout flag cleared'}), 200
    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500

@app.route('/api/admin/users/<user_id>')
@admin_required
def get_user(user_id):
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)}, {"password": 0, "login_history": 0})
        if not user:
            return jsonify({"status": "error", "error": "User not found"}), 404

        # Timezone-aware last login from session_logs
        last_log = logs_collection.find_one(
            {"email": user.get("email"), "action": "login_success"},
            sort=[("timestamp", -1)]
        )
        last_login_eat = to_eat(last_log["timestamp"]).strftime("%Y-%m-%d %H:%M") if last_log else "Never"

        # display_status
        now = tz_now()
        today_start_utc = now.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(pytz.utc)
        logged_in_today = logs_collection.find_one({
            "email": user.get("email"),
            "action": "login_success",
            "timestamp": {"$gte": today_start_utc}
        })
        if user.get("status") == "active":
            display_status = "active" if logged_in_today else "approved"
        else:
            display_status = user.get("status")

        # Date filter for logs
        date_str = request.args.get("date")
        log_query = {"email": user.get("email")}
        if date_str:
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d")
                day_start = NAIROBI_TZ.localize(date_obj.replace(hour=0, minute=0, second=0))
                day_end   = NAIROBI_TZ.localize(date_obj.replace(hour=23, minute=59, second=59))
                log_query["timestamp"] = {
                    "$gte": day_start.astimezone(pytz.utc),
                    "$lte": day_end.astimezone(pytz.utc)
                }
            except ValueError:
                pass

        # Pagination
        page     = int(request.args.get("page", 1))
        per_page = 50
        skip     = (page - 1) * per_page

        total_logs  = logs_collection.count_documents(log_query)
        total_pages = max(1, (total_logs + per_page - 1) // per_page)

        logs = list(logs_collection.find(log_query, {"_id": 0})
            .sort("timestamp", -1)
            .skip(skip)
            .limit(per_page))

        for log in logs:
            if log.get("timestamp"):
                log["timestamp"] = to_eat(log["timestamp"]).strftime("%Y-%m-%d %H:%M:%S")
            else:
                log["timestamp"] = "—"
            log.setdefault("reason", "—")
            log.setdefault("ip_address", "—")
            log.setdefault("user_agent", "—")

        user_data = serialize_user(user)
        user_data["last_login"]     = last_login_eat
        user_data["display_status"] = display_status

        return jsonify({"status": "success", "data": {
            "user": user_data,
            "session_logs": logs,
            "pagination": {
                "current_page": page,
                "total_pages":  total_pages,
                "total_logs":   total_logs,
                "has_prev":     page > 1,
                "has_next":     page < total_pages
            }
        }}), 200

    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>/approve', methods=['POST'])
@admin_required
def approve_user(user_id):
    try:
        result = users_collection.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "active"}})
        if result.matched_count == 0:
            return jsonify({"status": "error", "error": "User not found"}), 404
        user = users_collection.find_one({"_id": ObjectId(user_id)}, {"email": 1})
        logs_collection.insert_one({
            'email':      user.get('email', '—'),
            'action':     'account_approved',
            'reason':     'admin_approved',
            'timestamp':  tz_now(),
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent')
        })
        return jsonify({"status": "success", "message": "User approved"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>/block', methods=['POST'])
@admin_required
def block_user(user_id):
    try:
        result = users_collection.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "blocked"}})
        if result.matched_count == 0:
            return jsonify({"status": "error", "error": "User not found"}), 404
        return jsonify({"status": "success", "message": "User blocked"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>/unblock', methods=['POST'])
@admin_required
def unblock_user(user_id):
    try:
        result = users_collection.update_one({"_id": ObjectId(user_id)}, {"$set": {"status": "active"}})
        if result.matched_count == 0:
            return jsonify({"status": "error", "error": "User not found"}), 404
        return jsonify({"status": "success", "message": "User unblocked"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>/force-logout', methods=['POST'])
@admin_required
def force_logout(user_id):
    try:
        result = users_collection.update_one({"_id": ObjectId(user_id)}, {"$set": {"force_logout": True}})
        if result.matched_count == 0:
            return jsonify({"status": "error", "error": "User not found"}), 404
        return jsonify({"status": "success", "message": "Force logout flagged"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>/reset-password', methods=['POST'])
@admin_required
def reset_password(user_id):
    try:
        from werkzeug.security import generate_password_hash
        import re
        data             = request.get_json()
        new_password     = data.get('new_password', '')
        confirm_password = data.get('confirm_password', '')

        if new_password != confirm_password:
            return jsonify({"status": "error", "error": "Passwords do not match"}), 400
        if not re.match(r"(?=.*\d)(?=.*[a-z])(?=.*[A-Z]).{8,}", new_password):
            return jsonify({"status": "error", "error": "Password must be 8+ chars with upper, lower, number"}), 400

        user = users_collection.find_one({"_id": ObjectId(user_id)}, {"email": 1})
        if not user:
            return jsonify({"status": "error", "error": "User not found"}), 404

        hashed = generate_password_hash(new_password, method='pbkdf2:sha256')
        users_collection.update_one({"_id": ObjectId(user_id)}, {
            "$set": {"password": hashed, "last_password_reset": tz_now()}
        })
        logs_collection.insert_one({
            'email':      user['email'],
            'action':     'password_reset_request',
            'reason':     'admin_reset',
            'timestamp':  tz_now(),
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent')
        })
        return jsonify({"status": "success", "message": "Password reset successfully"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>/role', methods=['POST'])
@admin_required
def change_role(user_id):
    try:
        data     = request.get_json()
        new_role = data.get('role', '').strip()
        if new_role not in ['user', 'manager', 'admin']:
            return jsonify({"status": "error", "error": "Invalid role"}), 400
        user = users_collection.find_one({"_id": ObjectId(user_id)}, {"email": 1, "role": 1})
        if not user:
            return jsonify({"status": "error", "error": "User not found"}), 404
        users_collection.update_one({"_id": ObjectId(user_id)}, {"$set": {"role": new_role}})
        logs_collection.insert_one({
            'email':      user.get('email', '—'),
            'action':     'role_changed',
            'reason':     f"{user.get('role','?')} → {new_role}",
            'timestamp':  tz_now(),
            'ip_address': request.remote_addr,
            'user_agent': request.headers.get('User-Agent')
        })
        return jsonify({"status": "success", "message": f"Role updated to {new_role}"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

# ============================================================================
# API: SECURITY LOGS
# ============================================================================

@app.route('/api/admin/security')
@admin_required
def get_security_logs():
    try:
        date_from = request.args.get('date_from')
        date_to   = request.args.get('date_to')
        ip_filter = request.args.get('ip', '').strip()
        reason    = request.args.get('reason', '').strip()
        quick     = request.args.get('quick', '').strip()

        query = {"action": "login_failed"}
        now   = tz_now()

        if quick == 'today':
            query["timestamp"] = {"$gte": now.replace(hour=0, minute=0, second=0, microsecond=0)}
        elif quick == 'yesterday':
            start = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
            end   = now.replace(hour=0, minute=0, second=0, microsecond=0)
            query["timestamp"] = {"$gte": start, "$lt": end}
        elif quick == 'week':
            query["timestamp"] = {"$gte": now - timedelta(days=7)}
        else:
            if date_from or date_to:
                query["timestamp"] = {}
                if date_from:
                    query["timestamp"]["$gte"] = datetime.strptime(date_from, '%Y-%m-%d').replace(
                        hour=0, minute=0, second=0, tzinfo=NAIROBI_TZ)
                if date_to:
                    query["timestamp"]["$lte"] = datetime.strptime(date_to, '%Y-%m-%d').replace(
                        hour=23, minute=59, second=59, tzinfo=NAIROBI_TZ)

        if reason:    query["reason"]     = reason
        if ip_filter: query["ip_address"] = {"$regex": ip_filter, "$options": "i"}

        logs = list(logs_collection.find(query).sort("timestamp", -1).limit(500))
        return jsonify({"status": "success", "count": len(logs), "data": [serialize_log(l) for l in logs]}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500


@app.route('/api/admin/logs')
@admin_required
def get_all_logs():
    """General app logs endpoint — all actions, paginated, for Logs section."""
    try:
        date_from = request.args.get('date_from', '').strip()
        date_to   = request.args.get('date_to',   '').strip()
        action    = request.args.get('action',    '').strip()
        search    = request.args.get('q',         '').strip()
        page      = max(1, int(request.args.get('page', 1)))
        per_page  = 100

        query = {}

        if date_from or date_to:
            query['timestamp'] = {}
            if date_from:
                query['timestamp']['$gte'] = datetime.strptime(date_from, '%Y-%m-%d').replace(
                    hour=0, minute=0, second=0, tzinfo=NAIROBI_TZ)
            if date_to:
                query['timestamp']['$lte'] = datetime.strptime(date_to, '%Y-%m-%d').replace(
                    hour=23, minute=59, second=59, tzinfo=NAIROBI_TZ)

        if action and action != 'all':
            query['action'] = action

        if search:
            query['$or'] = [
                {'email':      {'$regex': search, '$options': 'i'}},
                {'ip_address': {'$regex': search, '$options': 'i'}},
            ]

        total = logs_collection.count_documents(query)
        logs  = list(
            logs_collection.find(query)
            .sort('timestamp', -1)
            .skip((page - 1) * per_page)
            .limit(per_page)
        )

        return jsonify({
            'status': 'success',
            'total':  total,
            'page':   page,
            'pages':  (total + per_page - 1) // per_page,
            'data':   [serialize_log(l) for l in logs]
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


# ============================================================================
# API: DB LOGS — persistent auth + lifecycle history
# ============================================================================

@app.route('/api/db/auth-logs')
@admin_required
def get_db_auth_logs():
    try:
        date_from = request.args.get('from', '').strip()
        date_to   = request.args.get('to',   '').strip()
        log_type  = request.args.get('type', 'all').strip()
        search    = request.args.get('q',    '').strip()
        page      = max(1, int(request.args.get('page', 1)))
        per_page  = 100

        query = {}

        if date_from or date_to:
            query['timestamp'] = {}
            if date_from:
                query['timestamp']['$gte'] = datetime.strptime(date_from, '%Y-%m-%d').replace(
                    hour=0, minute=0, second=0, tzinfo=NAIROBI_TZ)
            if date_to:
                query['timestamp']['$lte'] = datetime.strptime(date_to, '%Y-%m-%d').replace(
                    hour=23, minute=59, second=59, tzinfo=NAIROBI_TZ)

        if log_type != 'all':
            query['type'] = log_type

        if search:
            query['$or'] = [
                {'username': {'$regex': search, '$options': 'i'}},
                {'app_user': {'$regex': search, '$options': 'i'}},
                {'ip':       {'$regex': search, '$options': 'i'}},
            ]

        total  = db_auth_logs.count_documents(query)
        events = list(
            db_auth_logs.find(query)
            .sort('timestamp', -1)
            .skip((page - 1) * per_page)
            .limit(per_page)
        )

        def serialize_auth_log(e):
            ts = e.get('timestamp')
            return {
                'type':     e.get('type', '—'),
                'username': e.get('username', '—'),
                'app_user': e.get('app_user'),
                'ip':       e.get('ip', '—'),
                'app_name': e.get('app_name'),
                'timestamp': ts.strftime('%Y-%m-%d %H:%M:%S') if ts else e.get('raw_ts', '—'),
            }

        return jsonify({
            'status': 'success',
            'total':  total,
            'page':   page,
            'pages':  (total + per_page - 1) // per_page,
            'data':   [serialize_auth_log(e) for e in events]
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


@app.route('/api/db/lifecycle-logs')
@admin_required
def get_db_lifecycle_logs():
    try:
        date_from = request.args.get('from', '').strip()
        date_to   = request.args.get('to',   '').strip()
        page      = max(1, int(request.args.get('page', 1)))
        per_page  = 100

        query = {}

        if date_from or date_to:
            query['timestamp'] = {}
            if date_from:
                query['timestamp']['$gte'] = datetime.strptime(date_from, '%Y-%m-%d').replace(
                    hour=0, minute=0, second=0, tzinfo=NAIROBI_TZ)
            if date_to:
                query['timestamp']['$lte'] = datetime.strptime(date_to, '%Y-%m-%d').replace(
                    hour=23, minute=59, second=59, tzinfo=NAIROBI_TZ)

        total  = db_lifecycle_logs.count_documents(query)
        events = list(
            db_lifecycle_logs.find(query)
            .sort('timestamp', -1)
            .skip((page - 1) * per_page)
            .limit(per_page)
        )

        def serialize_lifecycle(e):
            ts = e.get('timestamp')
            return {
                'type':      e.get('type', '—'),
                'pid':       e.get('pid'),
                'port':      e.get('port'),
                'host':      e.get('host'),
                'uid':       e.get('uid'),
                'db_path':   e.get('db_path'),
                'timestamp': ts.strftime('%Y-%m-%d %H:%M:%S') if ts else e.get('raw_ts', '—'),
            }

        return jsonify({
            'status': 'success',
            'total':  total,
            'page':   page,
            'pages':  (total + per_page - 1) // per_page,
            'data':   [serialize_lifecycle(e) for e in events]
        }), 200

    except Exception as e:
        return jsonify({'status': 'error', 'error': str(e)}), 500


# ============================================================================
# API: DB CONSOLE (whitelisted commands)
# ============================================================================

ALLOWED_COMMANDS = {
    'serverStatus':  lambda adb, arg: adb.command('serverStatus'),
    'currentOp':     lambda adb, arg: adb.command('currentOp'),
    'listDatabases': lambda adb, arg: adb.command('listDatabases'),
    'listSessions':  lambda adb, arg: adb.command('listSessions', allUsers=True),
    'listUsers':     lambda adb, arg: adb.command('usersInfo', 1),
    'killSession':   lambda adb, arg: adb.command('killSessions', [{"id": arg}]) if arg else None,
}

@app.route('/api/db/console', methods=['POST'])
@admin_required
def db_console():
    try:
        data    = request.get_json()
        command = data.get('command', '').strip()
        arg     = data.get('arg', '').strip()

        if command not in ALLOWED_COMMANDS:
            return jsonify({"status": "error", "error": f"Command '{command}' not allowed"}), 400

        if command == 'killSession' and not arg:
            return jsonify({"status": "error", "error": "Session ID required for killSession"}), 400

        result = ALLOWED_COMMANDS[command](admin_db, arg)

        # Serialize BSON to JSON-safe dict
        safe = json.loads(bson_dumps(result)) if result else {}
        return jsonify({"status": "success", "result": safe}), 200

    except OperationFailure as e:
        return jsonify({"status": "error", "error": f"MongoDB error: {e.details.get('errmsg', str(e))}"}), 500
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/db/kill-session', methods=['POST'])
@admin_required
def kill_db_session():
    try:
        data    = request.get_json()
        conn_id = data.get('connection_id')
        if not conn_id:
            return jsonify({"status": "error", "error": "connection_id required"}), 400

        admin_db.command('killConnections', {'$comment': str(conn_id)})
        return jsonify({"status": "success", "message": f"Connection {conn_id} killed"}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

# ============================================================================
# WEBSOCKET — MongoDB log watcher
# ============================================================================

class MongoEventProcessor:
    def __init__(self):
        self.active_connections = {}
        self.logged_in_users    = {}
        self.recent_failures    = {}
        self.auth_events        = deque(maxlen=1000)
        self.stats = {
            'total_logins':    0,
            'failed_auths':    0,
            'active_sessions': 0,
            'server_restarts': 0
        }

    def emit(self, event, data):
        try:
            socketio.emit(event, data, namespace='/')
        except Exception as e:
            print(f"[WS Emit Error] {e}")

    def process_event(self, event):
        c = event['component']
        if c == 'NETWORK':  self.handle_network(event)
        elif c == 'ACCESS':  self.handle_access(event)
        elif c == 'CONTROL': self.handle_control(event)
        elif c == 'STORAGE': self.handle_storage(event)

    def is_recent(self, key, current_time, window=3):
        if key in self.recent_failures:
            try:
                last = datetime.fromisoformat(self.recent_failures[key].replace('Z', '+00:00'))
                curr = datetime.fromisoformat(current_time.replace('Z', '+00:00'))
                if (curr - last).total_seconds() < window:
                    return True
            except Exception:
                pass
        return False

    def get_client_tag(self, conn_id):
        """Derive PYMONGO/SHELL/COMPASS/INTERNAL/DIRECT from stored metadata."""
        conn     = self.active_connections.get(conn_id, {})
        driver   = (conn.get('driver')   or '').lower()
        app_name = (conn.get('app_name') or '').lower()
        combined = f"{driver} {app_name}"
        if 'pymongo'  in combined: return 'PYMONGO'
        if 'mongosh'  in combined: return 'SHELL'
        if 'compass'  in combined: return 'COMPASS'
        if 'internal' in combined: return 'INTERNAL'
        if conn.get('app_name'):   return conn['app_name'].upper()[:10]
        return 'DIRECT'

    def handle_network(self, event):
        log_id = event['id']
        attr   = event['attr']

        if log_id == 22943:  # connection accepted
            conn_id   = attr.get('connectionId')
            remote_ip = attr.get('remote', '').split(':')[0]
            self.active_connections[conn_id] = {
                'connection_id': conn_id,
                'ip':            remote_ip,
                'connect_time':  event['timestamp'],
                'username':      None,
                'app_name':      None,
                'driver':        None,
            }

        elif log_id == 51800:  # client metadata — driver.name + application.name
            ctx      = event['context']
            conn_num = ctx.replace('conn', '') if 'conn' in ctx else None
            if conn_num and conn_num.isdigit():
                conn_id = int(conn_num)
                if conn_id in self.active_connections:
                    doc      = attr.get('doc', {})
                    driver   = doc.get('driver',      {}).get('name', '')
                    app_name = doc.get('application', {}).get('name', '')
                    self.active_connections[conn_id]['driver']   = driver
                    self.active_connections[conn_id]['app_name'] = app_name or driver or None

        elif log_id == 22944:  # connection ended — emit logout per conn_id
            conn_id    = attr.get('connectionId')
            if conn_id not in self.active_connections:
                return
            connection = self.active_connections.pop(conn_id)
            username   = connection.get('username')
            remote_ip  = connection.get('ip')

            if username:
                tag = self.get_client_tag(conn_id) if conn_id in self.active_connections else 'DIRECT'
                self.emit('logout', {
                    'username':        username,
                    'ip':              remote_ip,
                    'disconnect_time': event['timestamp'],
                    'connection_id':   conn_id,
                    'client_tag':      tag,
                })
                # Remove from logged_in_users only if no more open connections
                user_key = f"{username}@{remote_ip}"
                if user_key in self.logged_in_users:
                    conns = self.logged_in_users[user_key].get('connections', [])
                    if conn_id in conns:
                        conns.remove(conn_id)
                    if not conns:
                        del self.logged_in_users[user_key]

    def handle_access(self, event):
        log_id = event['id']
        attr   = event['attr']
        ctx    = event['context']

        if log_id == 20250:  # auth success
            username  = attr.get('principalName')
            remote_ip = attr.get('remote', '').split(':')[0]
            conn_num  = ctx.replace('conn', '') if 'conn' in ctx else None
            conn_id   = int(conn_num) if conn_num and conn_num.isdigit() else None

            if conn_id and conn_id in self.active_connections:
                self.active_connections[conn_id]['username'] = username

            # Track by conn_id not username@ip — each connection is its own session
            conn_key  = str(conn_id) if conn_id else f"{username}@{remote_ip}"
            app_name  = self.active_connections.get(conn_id, {}).get('app_name') if conn_id else None
            client_tag = self.get_client_tag(conn_id) if conn_id else 'DIRECT'

            # Look up email from session_logs for PyMongo app connections
            app_user = None
            if client_tag == 'PYMONGO':
                try:
                    window_start = tz_now() - timedelta(seconds=5)
                    log_entry = logs_collection.find_one(
                        {'action': 'login_success', 'ip_address': remote_ip,
                         'timestamp': {'$gte': window_start}},
                        sort=[('timestamp', -1)]
                    )
                    if log_entry:
                        app_user = log_entry.get('email')
                except Exception:
                    pass

            self.emit('login', {
                'connection_id': conn_id,
                'username':      username,
                'ip':            remote_ip,
                'connect_time':  event['timestamp'],
                'app_name':      app_name,
                'client_tag':    client_tag,
                'app_user':      app_user,
            })

            user_key = f"{username}@{remote_ip}"
            if user_key not in self.logged_in_users:
                self.logged_in_users[user_key] = {
                    'username': username, 'ip': remote_ip,
                    'login_time': event['timestamp'],
                    'connections': []
                }
            if conn_id and conn_id not in self.logged_in_users[user_key]['connections']:
                self.logged_in_users[user_key]['connections'].append(conn_id)

            self.stats['total_logins'] += 1

            # Persist — every connection gets its own record
            try:
                ev_type = 'app' if client_tag == 'PYMONGO' else 'success'
                db_auth_logs.insert_one({
                    'type':       ev_type,
                    'username':   username,
                    'app_user':   app_user,
                    'ip':         remote_ip,
                    'app_name':   app_name,
                    'client_tag': client_tag,
                    'timestamp':  tz_now(),
                    'raw_ts':     event['timestamp'],
                })
            except Exception as e:
                print(f"[Auth log insert error] {e}")

        elif log_id == 20249:  # auth failed
            username  = attr.get('principalName')
            remote_ip = attr.get('remote', '').split(':')[0]
            user_key  = f"{username}@{remote_ip}"
            conn_num  = ctx.replace('conn', '') if 'conn' in ctx else None
            conn_id   = int(conn_num) if conn_num and conn_num.isdigit() else None
            client_tag = self.get_client_tag(conn_id) if conn_id else 'DIRECT'

            if not self.is_recent(user_key, event['timestamp']):
                self.emit('auth_failed', {
                    'username':   username,
                    'ip':         remote_ip,
                    'timestamp':  event['timestamp'],
                    'client_tag': client_tag,
                })
                self.recent_failures[user_key] = event['timestamp']
                self.stats['failed_auths'] += 1
                try:
                    app_name = self.active_connections.get(conn_id, {}).get('app_name') if conn_id else None
                    db_auth_logs.insert_one({
                        'type':       'failed',
                        'username':   username,
                        'app_user':   None,
                        'ip':         remote_ip,
                        'app_name':   app_name,
                        'client_tag': client_tag,
                        'timestamp':  tz_now(),
                        'raw_ts':     event['timestamp'],
                    })
                except Exception as e:
                    print(f"[Auth failed log insert error] {e}")

    def handle_control(self, event):
        log_id = event['id']
        attr   = event['attr']

        if log_id == 20698:
            self.emit('server_restart', {'timestamp': event['timestamp']})
            self.stats['server_restarts'] += 1
            self.active_connections.clear()
            self.logged_in_users.clear()
            self.recent_failures.clear()
            try:
                db_lifecycle_logs.insert_one({'type': 'restart', 'timestamp': tz_now(), 'raw_ts': event['timestamp']})
            except Exception:
                pass

        elif log_id == 20565:
            self.emit('server_shutdown', {'timestamp': event['timestamp']})
            try:
                db_lifecycle_logs.insert_one({'type': 'shutdown', 'timestamp': tz_now(), 'raw_ts': event['timestamp']})
            except Exception:
                pass

        elif log_id == 23378:
            self.emit('server_killed', {
                'timestamp': event['timestamp'],
                'pid':       attr.get('pid'),
                'uid':       attr.get('uid')
            })
            try:
                db_lifecycle_logs.insert_one({
                    'type':      'killed',
                    'pid':       attr.get('pid'),
                    'uid':       attr.get('uid'),
                    'timestamp': tz_now(),
                    'raw_ts':    event['timestamp'],
                })
            except Exception:
                pass

    def handle_storage(self, event):
        if event['id'] == 4615611:
            attr = event['attr']
            self.emit('server_started', {
                'timestamp': event['timestamp'],
                'pid':       attr.get('pid'),
                'port':      attr.get('port'),
                'host':      attr.get('host'),
                'db_path':   attr.get('dbPath')
            })
            try:
                db_lifecycle_logs.insert_one({
                    'type':      'started',
                    'pid':       attr.get('pid'),
                    'port':      attr.get('port'),
                    'host':      attr.get('host'),
                    'db_path':   attr.get('dbPath'),
                    'timestamp': tz_now(),
                    'raw_ts':    event['timestamp'],
                })
            except Exception:
                pass

    def get_active_sessions(self):
        """Return one row per open connection, not per user."""
        sessions = []
        for conn_id, conn in self.active_connections.items():
            if not conn.get('username'):
                continue  # not authenticated yet
            client_tag = self.get_client_tag(conn_id)
            sessions.append({
                'connection_id': conn_id,
                'username':      conn['username'],
                'ip':            conn['ip'],
                'connect_time':  conn['connect_time'],
                'app_name':      conn.get('app_name'),
                'client_tag':    client_tag,
                'app_user':      conn.get('app_user'),
            })
        return sessions

    def get_stats(self):
        return {**self.stats, 'active_sessions': len(self.logged_in_users)}


class MongoLogWatcher(FileSystemEventHandler):
    def __init__(self, log_path, processor):
        self.log_path      = Path(log_path)
        self.processor     = processor
        self.file_position = 0

        if self.log_path.exists():
            # Start WARM — replay today's log lines through processor
            # so sessions, auth events and lifecycle are populated
            # before any client connects. No more cold start.
            self._warm_start()

    def _warm_start(self):
        """
        Scan backwards through today's log lines and replay them
        through the processor. Handles log that started before
        admin server. Sets file_position to end when done.
        """
        try:
            today = datetime.now(NAIROBI_TZ).strftime('%Y-%m-%dT')
            max_bytes = 200 * 1024  # scan last 200KB — enough for a day's log

            with open(self.log_path, 'r') as f:
                # Find scan start point
                f.seek(0, os.SEEK_END)
                end_pos = f.tell()
                seek_to = max(0, end_pos - max_bytes)
                f.seek(seek_to)
                if seek_to > 0:
                    f.readline()  # skip partial line

                today_lines = []
                for line in f:
                    line = line.strip()
                    if line and today in line:
                        today_lines.append(line)

                self.file_position = end_pos

            print(f"[Watcher] Warm start: replaying {len(today_lines)} today's log lines")

            for line in today_lines:
                self._parse_line_silent(line)

            print(f"[Watcher] Warm start complete — "
                  f"{len(processor.logged_in_users)} sessions, "
                  f"{processor.stats['total_logins']} logins, "
                  f"{processor.stats['failed_auths']} failed")

        except Exception as e:
            print(f"[Watcher] Warm start error: {e}")
            # Fall back to cold start at end of file
            try:
                with open(self.log_path, 'r') as f:
                    f.seek(0, os.SEEK_END)
                    self.file_position = f.tell()
            except Exception:
                self.file_position = 0

    def _parse_line_silent(self, line):
        """Parse a line without emitting WebSocket events — for warm start replay."""
        try:
            entry = json.loads(line)
            event = {
                'timestamp': entry.get('t', {}).get('$date', ''),
                'component': entry.get('c', ''),
                'id':        entry.get('id'),
                'message':   entry.get('msg', ''),
                'attr':      entry.get('attr', {}),
                'context':   entry.get('ctx', '')
            }
            # Process silently — patch emit to no-op during warm start
            original_emit = self.processor.emit
            self.processor.emit = lambda *a, **kw: None
            self.processor.process_event(event)
            self.processor.emit = original_emit
        except Exception:
            pass

    def on_modified(self, event):
        if event.src_path == str(self.log_path):
            self.read_new_lines()

    def read_new_lines(self):
        try:
            p = Path(self.log_path)
            if not p.exists():
                return

            current_size = p.stat().st_size

            # Log was rotated or truncated — reset position
            if current_size < self.file_position:
                print("[Watcher] Log rotated — resetting position")
                self.file_position = 0

            if current_size == self.file_position:
                return

            with open(self.log_path, 'r') as f:
                f.seek(self.file_position)
                for line in f.readlines():
                    line = line.strip()
                    if line:
                        self.parse_line(line)
                self.file_position = f.tell()

        except Exception as e:
            print(f"[Watcher] {e}")

    def parse_line(self, line):
        try:
            entry = json.loads(line)
            self.processor.process_event({
                'timestamp': entry.get('t', {}).get('$date', ''),
                'component': entry.get('c', ''),
                'id':        entry.get('id'),
                'message':   entry.get('msg', ''),
                'attr':      entry.get('attr', {}),
                'context':   entry.get('ctx', '')
            })
        except Exception:
            pass


# ============================================================================
# WEBSOCKET EVENTS
# ============================================================================

processor = MongoEventProcessor()

@socketio.on('connect')
def ws_connect():
    print(f"[WS] Client connected: {request.sid}")

    try:
        server_info = get_server_info()
    except Exception as e:
        server_info = {'error': str(e)}

    # Pull today's lifecycle history from DB — so frontend always has
    # full history on connect/reconnect/refresh without needing to remember
    try:
        today_start = tz_now().replace(hour=0, minute=0, second=0, microsecond=0)
        raw_lifecycle = list(
            db_lifecycle_logs.find(
                {'timestamp': {'$gte': today_start}},
                {'_id': 0}
            ).sort('timestamp', 1)  # ascending — oldest first, frontend prepends
        )
        lifecycle_history = []
        for ev in raw_lifecycle:
            ts = ev.get('timestamp')
            lifecycle_history.append({
                'type':      ev.get('type'),
                'pid':       ev.get('pid'),
                'port':      ev.get('port'),
                'host':      ev.get('host'),
                'uid':       ev.get('uid'),
                'timestamp': ts.isoformat() if hasattr(ts, 'isoformat') else ev.get('raw_ts', ''),
            })
    except Exception as e:
        print(f"[WS] lifecycle history error: {e}")
        lifecycle_history = []

    # Pull today's auth history from DB
    try:
        raw_auth = list(
            db_auth_logs.find(
                {'timestamp': {'$gte': today_start}},
                {'_id': 0}
            ).sort('timestamp', 1)  # ascending — oldest first
        )
        auth_history = []
        for ev in raw_auth:
            ts = ev.get('timestamp')
            auth_history.append({
                'type':      ev.get('type'),
                'username':  ev.get('username'),
                'app_user':  ev.get('app_user'),
                'ip':        ev.get('ip'),
                'app_name':  ev.get('app_name'),
                'timestamp': ts.isoformat() if hasattr(ts, 'isoformat') else ev.get('raw_ts', ''),
            })
    except Exception as e:
        print(f"[WS] auth history error: {e}")
        auth_history = []

    emit('initial_state', {
        'active_sessions':  processor.get_active_sessions(),
        'stats':            processor.get_stats(),
        'server_info':      server_info,
        'lifecycle_history': lifecycle_history,
        'auth_history':      auth_history,
        'timestamp':        datetime.now().isoformat()
    })

@socketio.on('disconnect')
def ws_disconnect():
    print(f"[WS] Client disconnected: {request.sid}")

# ============================================================================
# LOG WATCHER THREAD
# ============================================================================

def start_log_watcher():
    log = Path(LOG_PATH)

    # Wait for log file if MongoDB isn't up yet
    waited = 0
    while not log.exists():
        if waited == 0:
            print(f"[Watcher] Log not found: {LOG_PATH} — waiting for MongoDB...")
        time.sleep(2)
        waited += 2

    watcher  = MongoLogWatcher(LOG_PATH, processor)
    observer = Observer()
    observer.schedule(watcher, path=str(log.parent), recursive=False)
    observer.start()
    print(f"[Watcher] Watching {LOG_PATH}")

    while True:
        try:
            time.sleep(1)

            # If MongoDB went down and came back, the log file may have
            # been recreated. Watchdog keeps watching the directory so
            # on_modified still fires. But force-check every 2s as backup
            # in case the file reappeared without a modify event.
            if log.exists():
                watcher.read_new_lines()

        except Exception as e:
            print(f"[Watcher] Loop error: {e}")
            try:
                observer.stop()
            except Exception:
                pass
            # Restart the observer
            time.sleep(2)
            try:
                observer = Observer()
                observer.schedule(watcher, path=str(log.parent), recursive=False)
                observer.start()
                print("[Watcher] Observer restarted")
            except Exception as e2:
                print(f"[Watcher] Restart failed: {e2}")

# ============================================================================
# ENTRY POINT
# ============================================================================

if __name__ == '__main__':
    print("=" * 60)
    print("Dreamland Admin Server")
    print(f"MongoDB : {MONGO_URI}")
    print(f"Port    : {ADMIN_PORT}")
    print(f"Log     : {LOG_PATH}")
    print("=" * 60)

    watcher_thread = threading.Thread(target=start_log_watcher, daemon=True)
    watcher_thread.start()

    socketio.run(
        app,
        debug=False,
        host='0.0.0.0',
        port=ADMIN_PORT,
        allow_unsafe_werkzeug=True
    )
