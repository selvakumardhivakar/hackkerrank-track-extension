import os, json, hashlib, hmac, logging
from datetime import datetime, timezone
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass
from typing import Any, Dict, Optional
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

def is_tracking_enabled() -> bool:
    try:
        with get_db() as conn:
            with conn.cursor() as c:
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

@app.post("/api/settings/tracking")
def set_tracking(req: TrackingSettingRequest, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    val = 'true' if req.enabled else 'false'
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""
                INSERT INTO app_settings (key, value)
                VALUES ('tracking_enabled', %s)
                ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
            """, (val,))
        conn.commit()
    return {"ok": True, "tracking_enabled": req.enabled}

@app.get("/api/settings/tracking")
def get_tracking(x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    return {"ok": True, "tracking_enabled": is_tracking_enabled()}

@app.post("/api/events")
def create_event(e:Event):
    if not is_tracking_enabled():
        return {"ok":True,"ignored":True,"message":"Tracking is globally disabled."}
    
    ts=e.timestamp or datetime.now(timezone.utc).isoformat()
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("""INSERT INTO events
            (candidate_id,contest_url,event_type,timestamp,details)
            VALUES(%s,%s,%s,%s,%s)""",
            (e.candidateId,e.contestUrl,e.eventType,ts,json.dumps(e.details)))
        conn.commit()
    return {"ok":True}

@app.get("/api/summary")
def summary(contestUrl: Optional[str]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    where = " WHERE contest_url = %s" if contestUrl else ""
    base_args = [contestUrl] if contestUrl else []
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT COUNT(DISTINCT candidate_id) FROM events"+where, base_args)
            total = c.fetchone()[0]
            c.execute("SELECT COUNT(*) FROM events"+where, base_args)
            events = c.fetchone()[0]
            
            def count(types):
                marks=",".join(["%s"]*len(types))
                q="SELECT COUNT(*) FROM events"+where+(" AND " if where else " WHERE ")+f"event_type IN ({marks})"
                c.execute(q, base_args+types)
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
def candidates(contestUrl: Optional[str]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    contest_clause = " AND contest_url=%s" if contestUrl else ""
    args=[contestUrl] if contestUrl else []
    
    with get_db() as conn:
        with conn.cursor() as c:
            c.execute("SELECT candidate_id, MAX(timestamp) FROM events WHERE 1=1"+contest_clause+" GROUP BY candidate_id ORDER BY candidate_id", args)
            rows = c.fetchall()
            
            out=[]
            for cid, last in rows:
                def n(types):
                    q="SELECT COUNT(*) FROM events WHERE candidate_id=%s"+contest_clause+" AND event_type IN ("+",".join(["%s"]*len(types))+")"
                    c.execute(q, [cid]+([contestUrl] if contestUrl else [])+types)
                    return c.fetchone()[0]
                
                c.execute("SELECT details FROM events WHERE candidate_id=%s"+contest_clause+" ORDER BY id DESC LIMIT 1", [cid]+([contestUrl] if contestUrl else []))
                details_str = c.fetchone()[0]
                try:
                    details_json = json.loads(details_str)
                except:
                    details_json = {}
                
                tab=n(["TAB_SWITCH_AWAY"])
                esc=n(["ESCAPE_KEY"])
                fs=n(["BROWSER_FULLSCREEN_EXIT"])
                away=n(["NAVIGATED_AWAY"])
                starts=n(["CONTEST_SESSION_START"])
                reentries=n(["CONTEST_SESSION_REENTRY","CONTEST_DIRECT_REENTRY"])
                extensionReentries=n(["CONTEST_SESSION_REENTRY"])
                directReentries=n(["CONTEST_DIRECT_REENTRY"])
                passcodeAccepted=n(["FULLSCREEN_PASSCODE_ACCEPTED"])
                passcodeRejected=n(["FULLSCREEN_PASSCODE_REJECTED"])
                focus=n(["BROWSER_FOCUS_LOST"])
                
                violations=tab+esc+fs+away+focus
                status="ALERT" if violations>=5 else ("WARNING" if violations>0 else "NORMAL")
                out.append({
                  "candidateId":cid,
                  "studentName":details_json.get("studentName", ""),
                  "studentRegId":details_json.get("studentRegId", ""),
                  "hackerRankId":details_json.get("hackerRankId", ""),
                  "tabSwitches":tab,"escapes":esc,
                  "fullscreenExits":fs,"navigatedAway":away,
                  "focusLost":focus,"sessionStarts":starts,
                  "reentries":reentries,
                  "extensionReentries":extensionReentries,
                  "directReentries":directReentries,
                  "passcodeAccepted":passcodeAccepted,
                  "passcodeRejected":passcodeRejected,
                  "lastSeen":last,
                  "violations":violations,"status":status
                })
    return out


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
def events(limit:int=500, contestUrl: Optional[str]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    with get_db() as conn:
        with conn.cursor() as c:
            if contestUrl:
                c.execute("""SELECT id,candidate_id,contest_url,event_type,
                timestamp,details FROM events WHERE contest_url=%s ORDER BY id DESC LIMIT %s""",
                (contestUrl,min(limit,5000)))
            else:
                c.execute("""SELECT id,candidate_id,contest_url,event_type,
                timestamp,details FROM events ORDER BY id DESC LIMIT %s""",
                (min(limit,5000),))
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
