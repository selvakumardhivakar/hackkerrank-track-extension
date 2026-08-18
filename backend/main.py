import os, json, sqlite3, hashlib, hmac, logging
from datetime import datetime, timezone
try:
    from dotenv import load_dotenv
    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass
from typing import Any, Dict, Optional
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

DB=os.getenv("DB_PATH","contest_monitor.db")
ADMIN_KEY=os.getenv("ADMIN_KEY","test-admin-key")

app=FastAPI(title="HackerRank Contest Tracking API")
app.add_middleware(CORSMiddleware,allow_origins=["*"],allow_methods=["*"],allow_headers=["*"])

def init_db():
    with sqlite3.connect(DB) as c:
        c.execute("""CREATE TABLE IF NOT EXISTS events(
          id INTEGER PRIMARY KEY AUTOINCREMENT,
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

@app.get("/api/health")
def health(): return {"status":"ok","database":"sqlite"}

@app.post("/api/events")
def create_event(e:Event):
    ts=e.timestamp or datetime.now(timezone.utc).isoformat()
    with sqlite3.connect(DB) as c:
        c.execute("""INSERT INTO events
        (candidate_id,contest_url,event_type,timestamp,details)
        VALUES(?,?,?,?,?)""",
        (e.candidateId,e.contestUrl,e.eventType,ts,json.dumps(e.details)))
    return {"ok":True}

@app.get("/api/summary")
def summary(contestUrl: Optional[str]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    where = " WHERE contest_url = ?" if contestUrl else ""
    base_args = [contestUrl] if contestUrl else []
    with sqlite3.connect(DB) as c:
        total=c.execute("SELECT COUNT(DISTINCT candidate_id) FROM events"+where, base_args).fetchone()[0]
        events=c.execute("SELECT COUNT(*) FROM events"+where, base_args).fetchone()[0]
        def count(types):
            marks=",".join("?"*len(types))
            q="SELECT COUNT(*) FROM events"+where+(" AND " if where else " WHERE ")+f"event_type IN ({marks})"
            return c.execute(q,base_args+types).fetchone()[0]
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
    contest_clause = " AND contest_url=?" if contestUrl else ""
    with sqlite3.connect(DB) as c:
        args=[contestUrl] if contestUrl else []
        rows=c.execute("SELECT candidate_id, MAX(timestamp) FROM events WHERE 1=1"+contest_clause+" GROUP BY candidate_id ORDER BY candidate_id", args).fetchall()
    out=[]
    for cid,last in rows:
        with sqlite3.connect(DB) as c:
            def n(types):
                q="SELECT COUNT(*) FROM events WHERE candidate_id=?"+contest_clause+" AND event_type IN ("+",".join("?"*len(types))+")"
                return c.execute(q,[cid]+([contestUrl] if contestUrl else [])+types).fetchone()[0]
            details_str = c.execute("SELECT details FROM events WHERE candidate_id=?"+contest_clause+" ORDER BY id DESC LIMIT 1", [cid]+([contestUrl] if contestUrl else [])).fetchone()[0]
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
    with sqlite3.connect(DB) as c:
        c.execute("INSERT OR REPLACE INTO contest_passcodes (contest_url, passcode_hash) VALUES (?, ?)", (req.contestUrl, hash_val))
        c.commit()
    return {"ok": True, "message": "Passcode set for contest."}

@app.post("/api/verify-passcode")
def verify_passcode(req: PasscodeRequest):
    # Check for per-contest passcode
    with sqlite3.connect(DB) as c:
        row = c.execute("SELECT passcode_hash FROM contest_passcodes WHERE contest_url=?", (req.contestUrl,)).fetchone()
        
    if row:
        expected = row[0]
    else:
        # Fallback to global passcode
        expected = os.getenv("EXAM_PASSCODE_SHA256", "")
        if not expected:
            logging.warning("EXAM_PASSCODE_SHA256 is not set in the environment. Passcode verification will fail.")
        
    supplied = _passcode_hash(req.passcode)

    ok = bool(expected) and hmac.compare_digest(supplied.lower(), expected.lower())

    # Audit passcode attempts using the same events table.
    with sqlite3.connect(DB) as c:
        c.execute("""INSERT INTO events
        (candidate_id, contest_url, event_type, timestamp, details)
        VALUES (?, ?, ?, datetime('now'), ?)""", (
            req.candidateId,
            req.contestUrl,
            "FULLSCREEN_PASSCODE_ACCEPTED" if ok else "FULLSCREEN_PASSCODE_REJECTED",
            '{"source":"passcode_verification"}'
        ))
        c.commit()

    return {"ok": ok, "message": "Passcode accepted." if ok else "Invalid passcode."}

@app.get("/api/events")
def events(limit:int=500, contestUrl: Optional[str]=None, x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    with sqlite3.connect(DB) as c:
        if contestUrl:
            rows=c.execute("""SELECT id,candidate_id,contest_url,event_type,
            timestamp,details FROM events WHERE contest_url=? ORDER BY id DESC LIMIT ?""",
            (contestUrl,min(limit,5000))).fetchall()
        else:
            rows=c.execute("""SELECT id,candidate_id,contest_url,event_type,
            timestamp,details FROM events ORDER BY id DESC LIMIT ?""",
            (min(limit,5000),)).fetchall()
    return [{"id":r[0],"candidateId":r[1],"contestUrl":r[2],
      "eventType":r[3],"timestamp":r[4],"details":json.loads(r[5])} for r in rows]


@app.get("/api/contests")
def contests(x_admin_key:str=Header(default="")):
    auth(x_admin_key)
    with sqlite3.connect(DB) as c:
        rows=c.execute("""SELECT contest_url, COUNT(DISTINCT candidate_id) AS students,
        COUNT(*) AS events, MAX(timestamp) AS last_seen
        FROM events GROUP BY contest_url ORDER BY last_seen DESC""").fetchall()
    return [{"contestUrl":r[0],"students":r[1],"events":r[2],"lastSeen":r[3]} for r in rows]
