#!/usr/bin/env python3
"""
admin_server.py — Dreamland Admin Server
Standalone process: REST API + WebSocket MongoDB monitor + Admin UI
Port: 5001
"""

import os
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
        total       = users_collection.count_documents({})
        active_sess = users_collection.count_documents({'status': 'active'})
        pending     = users_collection.count_documents({'status': 'pending'})
        blocked     = users_collection.count_documents({'status': 'blocked'})
        since_24h   = tz_now() - timedelta(hours=24)
        failed_24h  = logs_collection.count_documents({
            'action': 'login_failed',
            'timestamp': {'$gte': since_24h}
        })
        return jsonify({"status": "success", "data": {
            "total_users":        total,
            "active_sessions":    active_sess,
            "pending_users":      pending,
            "blocked_users":      blocked,
            "failed_attempts_24h": failed_24h
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
            query['status'] = status
        users = list(users_collection.find(query, {"password": 0, "login_history": 0}))
        return jsonify({"status": "success", "data": [serialize_user(u) for u in users]}), 200
    except Exception as e:
        return jsonify({"status": "error", "error": str(e)}), 500

@app.route('/api/admin/users/<user_id>')
@admin_required
def get_user(user_id):
    try:
        user = users_collection.find_one({"_id": ObjectId(user_id)}, {"password": 0, "login_history": 0})
        if not user:
            return jsonify({"status": "error", "error": "User not found"}), 404
        logs = list(logs_collection.find({"email": user['email']}).sort("timestamp", -1).limit(100))
        return jsonify({"status": "success", "data": {
            "user":         serialize_user(user),
            "session_logs": [serialize_log(l) for l in logs]
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

    def handle_network(self, event):
        log_id = event['id']
        attr   = event['attr']

        if log_id == 22943:  # connection accepted
            conn_id    = attr.get('connectionId')
            remote_ip  = attr.get('remote', '').split(':')[0]
            self.active_connections[conn_id] = {
                'connection_id': conn_id, 'ip': remote_ip,
                'connect_time': event['timestamp'], 'username': None, 'app_name': None
            }

        elif log_id == 51800:  # client metadata
            ctx      = event['context']
            conn_num = ctx.replace('conn', '') if 'conn' in ctx else None
            if conn_num and conn_num.isdigit():
                conn_id = int(conn_num)
                if conn_id in self.active_connections:
                    doc = attr.get('doc', {})
                    self.active_connections[conn_id]['app_name'] = \
                        doc.get('application', {}).get('name')

        elif log_id == 22944:  # connection ended
            conn_id    = attr.get('connectionId')
            if conn_id not in self.active_connections:
                return
            connection = self.active_connections.pop(conn_id)
            username   = connection.get('username')
            remote_ip  = connection.get('ip')

            if username and remote_ip:
                user_key = f"{username}@{remote_ip}"
                if user_key in self.logged_in_users:
                    conns = self.logged_in_users[user_key]['connections']
                    if conn_id in conns:
                        conns.remove(conn_id)
                    if not conns:
                        self.emit('logout', {
                            'username': username,
                            'ip': remote_ip,
                            'disconnect_time': event['timestamp']
                        })
                        del self.logged_in_users[user_key]

    def handle_access(self, event):
        log_id = event['id']
        attr   = event['attr']
        ctx    = event['context']

        if log_id == 20250:  # auth success
            username  = attr.get('principalName')
            remote_ip = attr.get('remote', '').split(':')[0]
            user_key  = f"{username}@{remote_ip}"
            conn_num  = ctx.replace('conn', '') if 'conn' in ctx else None
            conn_id   = int(conn_num) if conn_num and conn_num.isdigit() else None

            if conn_id and conn_id in self.active_connections:
                self.active_connections[conn_id]['username'] = username

            if user_key not in self.logged_in_users:
                app_name = self.active_connections.get(conn_id, {}).get('app_name') if conn_id else None
                self.emit('login', {
                    'connection_id': conn_id,
                    'username':      username,
                    'ip':            remote_ip,
                    'connect_time':  event['timestamp'],
                    'app_name':      app_name
                })
                self.logged_in_users[user_key] = {
                    'username': username, 'ip': remote_ip,
                    'login_time': event['timestamp'],
                    'connections': [conn_id] if conn_id else []
                }
                self.stats['total_logins'] += 1
            else:
                if conn_id and conn_id not in self.logged_in_users[user_key]['connections']:
                    self.logged_in_users[user_key]['connections'].append(conn_id)

        elif log_id == 20249:  # auth failed
            username  = attr.get('principalName')
            remote_ip = attr.get('remote', '').split(':')[0]
            user_key  = f"{username}@{remote_ip}"

            if not self.is_recent(user_key, event['timestamp']):
                self.emit('auth_failed', {
                    'username':  username,
                    'ip':        remote_ip,
                    'timestamp': event['timestamp']
                })
                self.recent_failures[user_key] = event['timestamp']
                self.stats['failed_auths'] += 1

    def handle_control(self, event):
        log_id = event['id']
        attr   = event['attr']

        if log_id == 20698:
            self.emit('server_restart', {'timestamp': event['timestamp']})
            self.stats['server_restarts'] += 1
            self.active_connections.clear()
            self.logged_in_users.clear()
            self.recent_failures.clear()

        elif log_id == 20565:
            self.emit('server_shutdown', {'timestamp': event['timestamp']})

        elif log_id == 23378:
            self.emit('server_killed', {
                'timestamp': event['timestamp'],
                'pid':       attr.get('pid'),
                'uid':       attr.get('uid')
            })

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

    def get_active_sessions(self):
        sessions = []
        for s in self.logged_in_users.values():
            conn_id  = s['connections'][0] if s['connections'] else None
            app_name = self.active_connections.get(conn_id, {}).get('app_name') if conn_id else None
            sessions.append({
                'username':      s['username'],
                'ip':            s['ip'],
                'connect_time':  s['login_time'],
                'app_name':      app_name,
                'connection_id': conn_id,
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
            with open(self.log_path, 'r') as f:
                f.seek(0, os.SEEK_END)
                self.file_position = f.tell()

    def on_modified(self, event):
        if event.src_path == str(self.log_path):
            self.read_new_lines()

    def read_new_lines(self):
        try:
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
    emit('initial_state', {
        'active_sessions': processor.get_active_sessions(),
        'stats':           processor.get_stats(),
        'timestamp':       datetime.now().isoformat()
    })

@socketio.on('disconnect')
def ws_disconnect():
    print(f"[WS] Client disconnected: {request.sid}")

# ============================================================================
# LOG WATCHER THREAD
# ============================================================================

def start_log_watcher():
    log = Path(LOG_PATH)
    if not log.exists():
        print(f"[Watcher] Log not found: {LOG_PATH} — watcher disabled")
        return

    watcher  = MongoLogWatcher(LOG_PATH, processor)
    observer = Observer()
    observer.schedule(watcher, path=str(log.parent), recursive=False)
    observer.start()
    print(f"[Watcher] Watching {LOG_PATH}")

    try:
        while True:
            time.sleep(1)
    except Exception:
        observer.stop()
    observer.join()

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
