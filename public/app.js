let candidates=[],events=[],contests=[];
let isTracking=true;
const $=id=>document.getElementById(id);
function api(){return $("api").value.replace(/\/$/,"")}
function headers(){return {"x-admin-key":$("key").value.trim()}}
function contestParam(){const v=$("contestUrl").value.trim();return v?`&contestUrl=${encodeURIComponent(v)}`:""}
async function loadContests(){
 try{
  const r=await fetch(api()+"/contests",{headers:headers()});
  contests=await r.json();
  $("contestPreset").innerHTML='<option value="">All contests</option>'+
   contests.map(c=>`<option value="${escAttr(c.contestUrl)}">${esc(c.contestUrl)} (${c.students})</option>`).join("");
 }catch(e){console.error(e)}
}
function choosePreset(){
 $("contestUrl").value=$("contestPreset").value;
 load();
}
function applyFilter(){load()}
function clearFilter(){
 $("contestUrl").value="";
 $("contestPreset").value="";
 load();
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function escAttr(s){return esc(s)}
async function load(){
 try{
  const q=contestParam();
  const curl = $("contestUrl").value.trim();
  $("selectedContest").textContent=curl||"All contests";
  if($("setPasscodeBtn")) $("setPasscodeBtn").style.display = curl ? "inline-block" : "none";
  const [h,s,c,e]=await Promise.all([
   fetch(api()+"/health"),
   fetch(api()+"/summary?"+q.replace(/^&/,""),{headers:headers()}),
   fetch(api()+"/candidates?"+q.replace(/^&/,""),{headers:headers()}),
   fetch(api()+"/events?limit=100"+q,{headers:headers()})
  ]);
  const health=await h.json();
  $("health").textContent=health.status==="ok"?"Backend online":"Backend error";
  candidates=await c.json();events=await e.json();
  const sum=await s.json();
  $("students").textContent=sum.students||0;
  $("switches").textContent=sum.tabSwitches||0;
  $("escapes").textContent=sum.escapes||0;
  $("exits").textContent=sum.browserFullscreenExits||0;
  $("reentries").textContent=sum.reentries||0;
  $("directReentries").textContent=sum.directReentries||0;
  $("passcodeRejected").textContent=sum.passcodeRejected||0;
  $("dot").style.background="#22c55e";
  render();renderEvents();
 }catch(err){
  $("health").textContent="Backend offline";
  $("dot").style.background="#ef4444";
  console.error(err);
 }
}
function render(){
 const q=$("filter").value.toLowerCase();
 const list=candidates.filter(x=>
  x.candidateId.toLowerCase().includes(q) ||
  (x.studentName||"").toLowerCase().includes(q) ||
  (x.studentRegId||"").toLowerCase().includes(q) ||
  (x.hackerRankId||"").toLowerCase().includes(q)
).sort((a,b)=>b.violations-a.violations);
 $("rows").innerHTML=list.map(x=>{
  const cls=x.status==="ALERT"?"alert":x.status==="WARNING"?"warning":"normal";
  return `<tr><td><b>${esc(x.candidateId)}</b></td>
  <td>${esc(x.studentName)}</td><td>${esc(x.studentRegId)}</td><td>${esc(x.hackerRankId)}</td>
  <td><span class="badge ${cls}">${x.status}</span></td>
  <td>${x.tabSwitches}</td><td>${x.escapes}</td><td>${x.fullscreenExits}</td><td>${x.navigatedAway}</td>
  <td>${x.focusLost}</td><td>${x.sessionStarts}</td><td><b>${x.reentries}</b></td>
  <td><b>${x.directReentries||0}</b></td>
  <td><b>${x.passcodeRejected||0}</b></td>
  <td class="muted">${x.lastSeen?new Date(x.lastSeen).toLocaleString():"-"}</td></tr>`
 }).join("")||`<tr><td colspan="15">No candidates for this contest.</td></tr>`;
}
function renderEvents(){
 $("events").innerHTML=events.map(x=>`<tr><td class="muted">${new Date(x.timestamp).toLocaleTimeString()}</td>
 <td><b>${esc(x.candidateId)}</b></td><td class="muted">${esc(x.contestUrl)}</td>
 <td class="event">${esc(x.eventType)}</td><td class="muted">${esc(JSON.stringify(x.details||{}))}</td></tr>`).join("");
}

async function login() {
  const k = $("loginKey").value;
  $("key").value = k;
  try {
    const res = await fetch(api()+"/contests", {headers: headers()});
    if (res.ok) {
      $("loginOverlay").style.display = "none";
      await loadContests();
      await fetchTrackingStatus();
      await load();
      setInterval(load, 5000);
    } else {
      $("loginError").textContent = "Invalid Admin Key";
      $("loginError").style.display = "block";
    }
  } catch(e) {
    $("loginError").textContent = "Backend offline";
    $("loginError").style.display = "block";
  }
}


function exportCSV() {
  if (!candidates || !candidates.length) {
    alert("No candidates to export.");
    return;
  }
  const headers = ["Candidate ID", "Name", "Reg ID", "HackerRank ID", "Status", "Tab Switches", "Escapes", "FS Exits", "Nav Away", "Focus Lost", "Session Starts", "Re-entries", "Direct Returns", "Passcode Rejects", "Last Seen"];
  const rows = candidates.map(x => [
    x.candidateId, x.studentName||"", x.studentRegId||"", x.hackerRankId||"", x.status, x.tabSwitches, x.escapes, x.fullscreenExits, x.navigatedAway, x.focusLost, x.sessionStarts, x.reentries, x.directReentries||0, x.passcodeRejected||0, x.lastSeen
  ]);
  const csvContent = [headers.join(","), ...rows.map(e => e.map(f=> `"${String(f).replace(/"/g, '""')}"`).join(","))].join("\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", "contest_monitor_export.csv");
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function setContestPasscode() {
  const url = $("contestUrl").value.trim();
  if (!url) {
    alert("Please select a specific contest first.");
    return;
  }
  const passcode = prompt("Enter new passcode for contest:\n" + url + "\n\n(Leave empty to cancel)");
  if (!passcode) return;
  
  fetch(api() + "/contests/passcode", {
    method: "POST",
    headers: Object.assign({}, headers(), {"Content-Type": "application/json"}),
    body: JSON.stringify({ contestUrl: url, passcode: passcode })
  }).then(r => r.json()).then(data => {
    if (data.ok) alert("Passcode updated successfully for this contest!");
    else alert(data.message || "Failed to update passcode.");
  }).catch(e => {
    console.error(e);
    alert("Error updating passcode.");
  });
}

async function fetchTrackingStatus() {
  try {
    const r = await fetch(api()+"/settings/tracking", {headers: headers()});
    if (r.ok) {
      const data = await r.json();
      isTracking = data.tracking_enabled;
      updateTrackingBtn();
    }
  } catch(e) { console.error(e); }
}

function updateTrackingBtn() {
  const btn = $("trackingToggleBtn");
  if (!btn) return;
  btn.style.display = "inline-block";
  if (isTracking) {
    btn.textContent = "Stop Tracking";
    btn.style.background = "#ef4444";
    btn.style.borderColor = "#ef4444";
  } else {
    btn.textContent = "Start Tracking";
    btn.style.background = "#22c55e";
    btn.style.borderColor = "#22c55e";
  }
}

async function toggleTracking() {
  if (!confirm(`Are you sure you want to ${isTracking ? 'STOP' : 'START'} saving all incoming API events to the database?`)) return;
  
  try {
    const res = await fetch(api()+"/settings/tracking", {
      method: "POST",
      headers: Object.assign({}, headers(), {"Content-Type": "application/json"}),
      body: JSON.stringify({ enabled: !isTracking })
    });
    const data = await res.json();
    if (data.ok) {
      isTracking = data.tracking_enabled;
      updateTrackingBtn();
    } else {
      alert("Failed to update tracking setting");
    }
  } catch(e) {
    console.error(e);
    alert("Error updating tracking setting");
  }
}

