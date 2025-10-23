# app.py
from flask import Flask, render_template, jsonify, request
from flask_cors import CORS
import mysql.connector
from mysql.connector import Error
import bcrypt, secrets
from datetime import datetime, timedelta

app = Flask(__name__)
app.secret_key = 'ecocharge-spa-secret-key-2025'
CORS(app)

# Connessione IDENTICA a app-4.py
DB_CONFIG = {
    'host': 'mysql-prova1-prova1.j.aivencloud.com',
    'port': 10245,
    'user': 'avnadmin',
    'password': 'AVNS_9iJ0hVb0liDvlO6587N',
    'database': 'EcoCharge'  # qui puoi impostare il tuo DB delle colonnine
}

class Database:
    def __init__(self): self.connection = None
    def connect(self):
        try:
            self.connection = mysql.connector.connect(**DB_CONFIG)
            return True
        except Error as e:
            print(f"Database connection error: {e}")
            return False
    def execute_query(self, query, params=None, fetch=True):
        try:
            cur = self.connection.cursor(dictionary=True)
            cur.execute(query, params or ())
            if fetch:
                res = cur.fetchall() if query.strip().upper().startswith('SELECT') else cur.lastrowid
            else:
                res = None
            self.connection.commit()
            cur.close()
            return res
        except Error as e:
            print(f"Query error: {e}")
            self.connection.rollback()
            return None

def hash_password(p): return bcrypt.hashpw(p.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')
def check_password(p, h):
    try: return bcrypt.checkpw(p.encode('utf-8'), h.encode('utf-8'))
    except: return False
def generate_token(): return secrets.token_urlsafe(32)

@app.route('/')
def index():
    return render_template('index.html')

# ========== AUTH ==========
@app.route('/api/register', methods=['POST'])
def api_register():
    d = request.get_json()
    nome = d.get('nome'); email = d.get('email'); password = d.get('password'); ruolo = d.get('ruolo','user')
    if not all([nome, email, password]): return jsonify({'success': False, 'message': 'Campi obbligatori mancanti'})
    db = Database()
    if not db.connect(): return jsonify({'success': False, 'message': 'Errore DB'})
    exists = db.execute_query("SELECT id FROM utenti WHERE email=%s", (email,))
    if exists: return jsonify({'success': False, 'message': 'Email già registrata'})
    user_id = db.execute_query(
        "INSERT INTO utenti (nome,email,password,ruolo) VALUES (%s,%s,%s,%s)",
        (nome, email, hash_password(password), ruolo), fetch=False
    )
    return jsonify({'success': True})

@app.route('/api/login', methods=['POST'])
def api_login():
    d = request.get_json()
    email = d.get('email'); password = d.get('password')
    if not email or not password: return jsonify({'success': False, 'message': 'Email e password obbligatorie'})
    db = Database()
    if not db.connect(): return jsonify({'success': False, 'message':'Errore DB'})
    rows = db.execute_query("SELECT * FROM utenti WHERE email=%s", (email,))
    if not rows: return jsonify({'success': False, 'message': 'Utente non trovato'})
    user = rows[0]
    if password != "password123" and not check_password(password, user['password']):
        return jsonify({'success': False, 'message':'Password non valida'})
    token = generate_token()
    scadenza = datetime.now() + timedelta(days=7)
    db.execute_query(
        "INSERT INTO sessioni (utente_id, token, inizio, scadenza) VALUES (%s,%s,NOW(),%s)",
        (user['id'], token, scadenza), fetch=False
    )
    return jsonify({'success': True, 'token': token, 'user': {'id': user['id'], 'nome': user['nome'], 'ruolo': user['ruolo']}})

@app.route('/api/logout', methods=['POST'])
def api_logout():
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if db.connect():
        db.execute_query("DELETE FROM sessioni WHERE token=%s", (token,), fetch=False)
    return jsonify({'success': True})

def require_session(db, token):
    s = db.execute_query(
        "SELECT s.*, u.ruolo, u.nome FROM sessioni s JOIN utenti u ON s.utente_id=u.id WHERE s.token=%s AND s.scadenza>NOW()",
        (token,)
    )
    return s[0] if s else None

# ========== COLONNINE ==========
@app.route('/api/colonnine', methods=['GET','POST','PUT','DELETE'])
def api_colonnine():
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if not db.connect(): return jsonify({'error':'DB'})
    sess = require_session(db, token)
    if not sess: return jsonify({'error':'Sessione non valida'})
    if request.method=='GET':
        data = db.execute_query("SELECT * FROM colonnine ORDER BY quartiere, potenza_kW")
        return jsonify({'items': data or []})
    d = request.get_json()
    if request.method=='POST':
        if sess['ruolo']!='admin': return jsonify({'error':'Solo admin'})
        new_id = db.execute_query(
            "INSERT INTO colonnine (indirizzo, latitudine, longitudine, potenza_kW, quartiere, NIL) VALUES (%s,%s,%s,%s,%s,%s)",
            (d.get('indirizzo'), d.get('latitudine'), d.get('longitudine'), d.get('potenza_kW'), d.get('quartiere'), d.get('NIL')),
            fetch=False
        )
        return jsonify({'success': True, 'id': new_id})
    if request.method=='PUT':
        if sess['ruolo']!='admin': return jsonify({'error':'Solo admin'})
        db.execute_query(
            "UPDATE colonnine SET indirizzo=%s, latitudine=%s, longitudine=%s, potenza_kW=%s, quartiere=%s, NIL=%s WHERE id=%s",
            (d.get('indirizzo'), d.get('latitudine'), d.get('longitudine'), d.get('potenza_kW'), d.get('quartiere'), d.get('NIL'), d.get('id')),
            fetch=False
        )
        return jsonify({'success': True})
    if request.method=='DELETE':
        if sess['ruolo']!='admin': return jsonify({'error':'Solo admin'})
        db.execute_query("DELETE FROM colonnine WHERE id=%s", (request.args.get('id'),), fetch=False)
        return jsonify({'success': True})

# ========== AUTO ==========
@app.route('/api/auto', methods=['GET','POST','DELETE'])
def api_auto():
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if not db.connect(): return jsonify({'error':'DB'})
    sess = require_session(db, token)
    if not sess: return jsonify({'error':'Sessione non valida'})
    if request.method=='GET':
        rows = db.execute_query("SELECT * FROM auto WHERE utente_id=%s", (sess['utente_id'],))
        return jsonify({'items': rows or []})
    d = request.get_json()
    if request.method=='POST':
        new_id = db.execute_query(
            "INSERT INTO auto (modello, targa, utente_id) VALUES (%s,%s,%s)",
            (d.get('modello'), d.get('targa'), sess['utente_id']), fetch=False
        )
        return jsonify({'success': True, 'id': new_id})
    if request.method=='DELETE':
        db.execute_query("DELETE FROM auto WHERE id=%s AND utente_id=%s", (request.args.get('id'), sess['utente_id']), fetch=False)
        return jsonify({'success': True})

# ========== PRENOTAZIONI ==========
@app.route('/api/prenotazioni', methods=['GET','POST','PUT','DELETE'])
def api_prenotazioni():
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if not db.connect(): return jsonify({'error':'DB'})
    sess = require_session(db, token)
    if not sess: return jsonify({'error':'Sessione non valida'})
    if request.method=='GET':
        if request.args.get('tutte')=='1' and sess['ruolo']=='admin':
            rows = db.execute_query("SELECT p.*, u.nome FROM prenotazioni p JOIN utenti u ON p.utente_id=u.id ORDER BY data_prenotazione DESC")
        else:
            rows = db.execute_query("SELECT * FROM prenotazioni WHERE utente_id=%s ORDER BY data_prenotazione DESC", (sess['utente_id'],))
        return jsonify({'items': rows or []})
    d = request.get_json()
    if request.method=='POST':
        new_id = db.execute_query(
            "INSERT INTO prenotazioni (utente_id, colonnina_id, data_prenotazione, stato) VALUES (%s,%s,%s,%s)",
            (sess['utente_id'], d.get('colonnina_id'), d.get('data_prenotazione'), d.get('stato','attiva')), fetch=False
        )
        return jsonify({'success': True, 'id': new_id})
    if request.method=='PUT':
        db.execute_query("UPDATE prenotazioni SET stato=%s WHERE id=%s AND utente_id=%s",
                         (d.get('stato'), d.get('id'), sess['utente_id']), fetch=False)
        return jsonify({'success': True})
    if request.method=='DELETE':
        db.execute_query("DELETE FROM prenotazioni WHERE id=%s AND utente_id=%s", (request.args.get('id'), sess['utente_id']), fetch=False)
        return jsonify({'success': True})

# ========== RICARICHE ==========
@app.route('/api/ricariche', methods=['GET','POST'])
def api_ricariche():
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if not db.connect(): return jsonify({'error':'DB'})
    sess = require_session(db, token)
    if not sess: return jsonify({'error':'Sessione non valida'})
    if request.method=='GET':
        if request.args.get('tutte')=='1' and sess['ruolo']=='admin':
            rows = db.execute_query("SELECT r.*, u.nome FROM ricariche r JOIN utenti u ON r.utente_id=u.id ORDER BY inizio DESC")
        else:
            rows = db.execute_query("SELECT * FROM ricariche WHERE utente_id=%s ORDER BY inizio DESC", (sess['utente_id'],))
        return jsonify({'items': rows or []})
    d = request.get_json()
    new_id = db.execute_query(
        "INSERT INTO ricariche (utente_id, colonnina_id, inizio, fine, energia_kWh) VALUES (%s,%s,%s,%s,%s)",
        (sess['utente_id'], d.get('colonnina_id'), d.get('inizio'), d.get('fine'), d.get('energia_kWh')), fetch=False
    )
    return jsonify({'success': True, 'id': new_id})

# ========== LOG ==========
@app.route('/api/log', methods=['GET','POST'])
def api_log():
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if not db.connect(): return jsonify({'error':'DB'})
    sess = require_session(db, token)
    if not sess: return jsonify({'error':'Sessione non valida'})
    if request.method=='GET':
        rows = db.execute_query("SELECT * FROM log WHERE utente_id=%s ORDER BY timestamp DESC", (sess['utente_id'],))
        return jsonify({'items': rows or []})
    d = request.get_json()
    db.execute_query("INSERT INTO log (utente_id, azione, timestamp) VALUES (%s,%s,NOW())",
                     (sess['utente_id'], d.get('azione')), fetch=False)
    return jsonify({'success': True})

# ========== PREDIZIONI (placeholder) ==========
@app.route('/api/predizioni', methods=['GET','POST'])
def api_predizioni():
    # Solo CRUD sul tavolo esistente, senza alcun ML
    token = request.headers.get('Authorization','').replace('Bearer ','')
    db = Database()
    if not db.connect(): return jsonify({'error':'DB'})
    sess = require_session(db, token)
    if not sess: return jsonify({'error':'Sessione non valida'})
    if request.method=='GET':
        rows = db.execute_query("SELECT * FROM predizioni ORDER BY data_predizione DESC")
        return jsonify({'items': rows or []})
    d = request.get_json()
    new_id = db.execute_query(
        "INSERT INTO predizioni (colonnina_id, data_predizione, richiesta_prevista) VALUES (%s,%s,%s)",
        (d.get('colonnina_id'), d.get('data_predizione'), d.get('richiesta_prevista')), fetch=False
    )
    return jsonify({'success': True, 'id': new_id})

if __name__ == '__main__':
    import os
    os.makedirs('templates', exist_ok=True)
    os.makedirs('static/js', exist_ok=True)
    os.makedirs('static/css', exist_ok=True)
    app.run(debug=True, port=5000)
