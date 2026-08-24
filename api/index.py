import os, json, hashlib, hmac, logging
from datetime import datetime, timezone
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass
from typing import Any, Dict, Optional, Union, List
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import psycopg2
import psycopg2.extras

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    logging.warning("DATABASE_URL is not set. Database operations will fail.")

ADMIN_KEY=os.getenv("ADMIN_KEY","test-admin-key")

app=FastAPI(title="HackerRank Contest Tracking API")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])

def get_db():
    return psycopg2.connect(DATABASE_URL)

def init_db():
    if not DATABASE_URL: return
    try:
        with get_db() as conn:
            with conn.cursor() as c:
                c.execute("""CREATE TABLE IF NOT EXISTS events(
                  id SERIAL PRIMARY KEY,
                  candidate_id TEXT NOT NULL,
                  contest_url TEXT NOT NULL,
                  event_type TEXT NOT NULL,
                  timestamp TEXT NOT NULL,
                  details TEXT NOT NULL
                )""")
                c.execute("""CREATE TABLE IF NOT EXISTS contest_passcodes(
                  contest_url TEXT PRIMARY KEY,
                  passcode_hash TEXT NOT NULL
                )""")
                c.execute("""CREATE TABLE IF NOT EXISTS app_settings(
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL
                )""")
                c.execute("""INSERT INTO app_settings (key, value) VALUES ('tracking_enabled', 'true') ON CONFLICT (key) DO NOTHING""")
            conn.commit()
    except Exception as e:
        logging.error(f"Failed to initialize database: {e}")

init_db()

class Event(BaseModel):
    candidateId:str
    contestUrl:str
    eventType:str
    timestamp:Optional[str]=None
    details:Dict[str,Any]={}

def auth(key:str):
    if key!=ADMIN_KEY: raise HTTPException(401,"Invalid admin key")

class PasscodeRequest(BaseModel):
    candidateId: str
    contestUrl: str
    passcode: str

class SetPasscodeRequest(BaseModel):
    contestUrl: str
    passcode: str

def _passcode_hash(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()

def is_tracking_enabled(contestUrl: Optional[str] = None):
    try:
        with get_db() as conn:
            with conn.cursor() as c:
                if contestUrl:
                    c.execute("SELECT value FROM app_settings WHERE key=%s", (f"tracking_enabled:{contestUrl}",))
                    row = c.fetchone()
                    if row:
                        return row[0] == 'true'
                
                c.execute("SELECT value FROM app_settings WHERE key='tracking_enabled'")
                row = c.fetchone()
                if row:
                    return row[0] == 'true'
    except Exception as e:
        logging.error(f"Failed to fetch tracking status: {e}")
    return True

@app.get("/api/health")
def health(): return {"status":"ok","database":"postgres"}

class TrackingSettingRequest(BaseModel):
    enabled: bool
    contestUrl: Optional[str] = None

@app.post("/api/settings/tracking")
def set_tracking(req: TrackingSettingRequest, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    val = 'true' if req.enabled else 'false'
    key = f"tracking_enabled:{req.contestUrl}" if req.contestUrl else "tracking_enabled"
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""
                INSERT INTO app_settings (key, value)
                VALUES (%s, %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (key, val))
        conn.commit()
    return {"ok": True, "tracking_enabled": req.enabled, "contestUrl": req.contestUrl}

@app.get("/api/settings/tracking")
def get_tracking(contestUrl: Optional[str]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    return {"ok": True, "tracking_enabled": is_tracking_enabled(contestUrl), "contestUrl": contestUrl}

@app.post("/api/events")
def create_event(payload: Union[Event, List[Event]]):
    events_list = payload if isinstance(payload, list) else [payload]
    
    valid_events = []
    for e in events_list:
        if is_tracking_enabled(e.contestUrl):
            valid_events.append(e)
            
    if not valid_events:
        return {"ok":True,"ignored":True,"message":"Tracking is disabled for these contests."}
    
    with get_db() as conn:
        with conn.cursor() as c:
            for e in valid_events:
                ts = e.timestamp or datetime.now(timezone.utc).isoformat()
                c.execute("""INSERT INTO events
                (candidate_id,contest_url,event_type,timestamp,details)
                VALUES(%s,%s,%s,%s,%s)""",
                (e.candidateId, e.contestUrl, e.eventType, ts, json.dumps(e.details)))
        conn.commit()
    return {"ok":True}

@app.get("/api/summary")
def summary(contestUrl: Optional[str]=None, strictHr: bool=False, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    contest_clause = " WHERE 1=1"
    args = []
    if contestUrl:
        contest_clause += " AND contest_url = %s"
        args.append(contestUrl)
    if strictHr:
        contest_clause += " AND (details::json->>'url' IS NULL OR details::json->>'url' ILIKE %s)"
        args.append('%hackerrank.com%karunya%')
        
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT COUNT(DISTINCT candidate_id) FROM events"+contest_clause, args)
            total = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM events"+contest_clause, args)
            events = c.fetchone()[0]
            
            def count(types):
                marks=",".join(["%s"]*len(types))
                q="SELECT COUNT(*) FROM events"+contest_clause+f" AND event_type IN ({marks})"
                c.execute(q, args+types)
                return c.fetchone()[0]
            
            return {
              "students":total,
              "events":events,
              "tabSwitches":count(["TAB_SWITCH_AWAY"]),
              "escapes":count(["ESCAPE_KEY"]),
              "browserFullscreenExits":count(["BROWSER_FULLSCREEN_EXIT"]),
              "sessionStarts":count(["CONTEST_SESSION_START"]),
              "reentries":count(["CONTEST_SESSION_REENTRY","CONTEST_DIRECT_REENTRY"]),
              "extensionReentries":count(["CONTEST_SESSION_REENTRY"]),
              "directReentries":count(["CONTEST_DIRECT_REENTRY"]),
              "passcodeAccepted":count(["FULLSCREEN_PASSCODE_ACCEPTED"]),
              "passcodeRejected":count(["FULLSCREEN_PASSCODE_REJECTED"]),
              "navigationsAway":count(["NAVIGATED_AWAY"]),
              "focusLost":count(["BROWSER_FOCUS_LOST"])
            }

@app.get("/api/candidates")
def candidates(contestUrl: Optional[str]=None, strictHr: bool=False, page: int=1, limit: int=20, search: str="", x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    contest_clause = " AND contest_url=%s" if contestUrl else ""
    args=[contestUrl] if contestUrl else []
    
    if strictHr:
        contest_clause += " AND (details::json->>'url' IS NULL OR details::json->>'url' ILIKE %s)"
        args.append('%hackerrank.com%karunya%')
        
    offset = (page - 1) * limit
    search_term = f"%{search}%"
    
    query = f"""
    WITH grouped AS (
        SELECT 
            candidate_id, 
            MAX(timestamp) as last_seen,
            MAX(CASE WHEN details::json->>'studentName' != '' THEN details::json->>'studentName' ELSE '' END) as studentName,
            MAX(CASE WHEN details::json->>'studentRegId' != '' THEN details::json->>'studentRegId' ELSE '' END) as studentRegId,
            MAX(CASE WHEN details::json->>'hackerRankId' != '' THEN details::json->>'hackerRankId' ELSE '' END) as hackerRankId,
            SUM(CASE WHEN event_type = 'TAB_SWITCH_AWAY' THEN 1 ELSE 0 END) as tab,
            SUM(CASE WHEN event_type = 'ESCAPE_KEY' THEN 1 ELSE 0 END) as esc,
            SUM(CASE WHEN event_type = 'BROWSER_FULLSCREEN_EXIT' THEN 1 ELSE 0 END) as fs,
            SUM(CASE WHEN event_type = 'NAVIGATED_AWAY' THEN 1 ELSE 0 END) as away,
            SUM(CASE WHEN event_type = 'CONTEST_SESSION_START' THEN 1 ELSE 0 END) as starts,
            SUM(CASE WHEN event_type IN ('CONTEST_SESSION_REENTRY','CONTEST_DIRECT_REENTRY') THEN 1 ELSE 0 END) as reentries,
            SUM(CASE WHEN event_type = 'CONTEST_SESSION_REENTRY' THEN 1 ELSE 0 END) as extensionReentries,
            SUM(CASE WHEN event_type = 'CONTEST_DIRECT_REENTRY' THEN 1 ELSE 0 END) as directReentries,
            SUM(CASE WHEN event_type = 'FULLSCREEN_PASSCODE_ACCEPTED' THEN 1 ELSE 0 END) as passcodeAccepted,
            SUM(CASE WHEN event_type = 'FULLSCREEN_PASSCODE_REJECTED' THEN 1 ELSE 0 END) as passcodeRejected,
            SUM(CASE WHEN event_type = 'BROWSER_FOCUS_LOST' THEN 1 ELSE 0 END) as focus,
            SUM(CASE WHEN event_type IN ('TAB_SWITCH_AWAY', 'ESCAPE_KEY', 'BROWSER_FULLSCREEN_EXIT', 'NAVIGATED_AWAY', 'BROWSER_FOCUS_LOST') THEN 1 ELSE 0 END) as violations
        FROM events
        WHERE 1=1 {contest_clause}
        GROUP BY candidate_id
    )
    SELECT * FROM grouped
    WHERE (candidate_id ILIKE %s OR studentName ILIKE %s OR studentRegId ILIKE %s OR hackerRankId ILIKE %s)
    """
    
    with get_db() as conn:
        with conn.cursor() as c:
            count_args = args + [search_term, search_term, search_term, search_term]
            
            # Get paginated data
            paginated_query = query + " ORDER BY violations DESC, candidate_id ASC LIMIT %s OFFSET %s"
            data_args = count_args + [limit, offset]
            c.execute(paginated_query, data_args)
            rows = c.fetchall()
            
            out = []
            for r in rows:
                violations = int(r[16])
                status="ALERT" if violations>=5 else ("WARNING" if violations>0 else "NORMAL")
                out.append({
                  "candidateId": r[0],
                  "lastSeen": r[1],
                  "studentName": r[2],
                  "studentRegId": r[3],
                  "hackerRankId": r[4],
                  "tabSwitches": int(r[5]),
                  "escapes": int(r[6]),
                  "fullscreenExits": int(r[7]),
                  "navigatedAway": int(r[8]),
                  "sessionStarts": int(r[9]),
                  "reentries": int(r[10]),
                  "extensionReentries": int(r[11]),
                  "directReentries": int(r[12]),
                  "passcodeAccepted": int(r[13]),
                  "passcodeRejected": int(r[14]),
                  "focusLost": int(r[15]),
                  "violations": violations,
                  "status": status
                })
                
    return {"items": out, "total": -1, "page": page, "limit": limit}


@app.post("/api/contests/passcode")
def set_contest_passcode(req: SetPasscodeRequest, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    hash_val = _passcode_hash(req.passcode)
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""
                INSERT INTO contest_passcodes (contest_url, passcode_hash) 
                VALUES (%s, %s)
                ON CONFLICT (contest_url) 
                DO UPDATE SET passcode_hash = EXCLUDED.passcode_hash
            """, (req.contestUrl, hash_val))
        conn.commit()
    return {"ok": True, "message": "Passcode set for contest."}

@app.post("/api/verify-passcode")
def verify_passcode(req: PasscodeRequest):
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT passcode_hash FROM contest_passcodes WHERE contest_url=%s", (req.contestUrl,))
            row = c.fetchone()
            
            if row:
                expected = row[0]
            else:
                expected = os.getenv("EXAM_PASSCODE_SHA256", "")
                if not expected:
                    logging.warning("EXAM_PASSCODE_SHA256 is not set in the environment.")
                
            supplied = _passcode_hash(req.passcode)
            ok = bool(expected) and hmac.compare_digest(supplied.lower(), expected.lower())

            c.execute("""INSERT INTO events
            (candidate_id, contest_url, event_type, timestamp, details)
            VALUES (%s, %s, %s, CURRENT_TIMESTAMP, %s)""", (
                req.candidateId,
                req.contestUrl,
                "FULLSCREEN_PASSCODE_ACCEPTED" if ok else "FULLSCREEN_PASSCODE_REJECTED",
                '{"source":"passcode_verification"}'
            ))
        conn.commit()

    return {"ok": ok, "message": "Passcode accepted." if ok else "Invalid passcode."}

@app.get("/api/events")
def events(limit:int=500, contestUrl: Optional[str]=None, candidateId: Optional[str]=None, strictHr:Optional[bool]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    with get_db() as conn:
        with conn.cursor() as c:
            query = "SELECT id,candidate_id,contest_url,event_type,timestamp,details FROM events WHERE 1=1"
            args = []
            if contestUrl:
                query += " AND contest_url=%s"
                args.append(contestUrl)
            if candidateId:
                query += " AND candidate_id=%s"
                args.append(candidateId)
            if strictHr:
                query += " AND (details::json->>'url' IS NULL OR details::json->>'url' ILIKE %s)"
                args.append('%hackerrank.com%karunya%')
            
            query += " ORDER BY id DESC LIMIT %s"
            args.append(min(limit,5000))
            
            c.execute(query, args)
            rows = c.fetchall()
            
    return [{"id":r[0],"candidateId":r[1],"contestUrl":r[2],
      "eventType":r[3],"timestamp":r[4],"details":json.loads(r[5])} for r in rows]

@app.get("/api/contests")
def contests(x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""SELECT contest_url, COUNT(DISTINCT candidate_id) AS students,
            COUNT(*) AS events, MAX(timestamp) AS last_seen
            FROM events GROUP BY contest_url ORDER BY last_seen DESC""")
            rows = c.fetchall()
    return [{"contestUrl":r[0],"students":r[1],"events":r[2],"lastSeen":r[3]} for r in rows]

import os
public_dir = os.path.join(os.path.dirname(__file__), "..", "public")
if os.path.exists(public_dir):
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=public_dir, html=True), name="public")
