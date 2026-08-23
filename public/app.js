let candidates=[],events=[],contests=[];
let isTracking=true;
let currentPage = 1;
let totalCandidates = 0;
let searchTimer = null;
let selectedCandidateId = null;
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
function applyFilter(){ currentPage = 1; load() }
function clearFilter(){
 $("contestUrl").value="";
 $("contestPreset").value="";
 $("filter").value="";
 currentPage = 1;
 load();
}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]))}
function escAttr(s){return esc(s)}

function showLoader() {
  const spinHtml = `<div style="display:inline-block;width:20px;height:20px;border:3px solid rgba(255,255,255,0.1);border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite;"></div>`;
  $("rows").innerHTML = `<tr><td colspan="15" style="text-align:center; padding: 30px; color: #94a3b8;">${spinHtml} <span style="vertical-align:super;margin-left:8px;">Loading candidates...</span></td></tr>`;
  $("events").innerHTML = `<tr><td colspan="5" style="text-align:center; padding: 30px; color: #94a3b8;">${spinHtml} <span style="vertical-align:super;margin-left:8px;">Loading events...</span></td></tr>`;
}

async function load(){
 showLoader();
 try{
  const q=contestParam();
  const curl = $("contestUrl").value.trim();
  $("selectedContest").textContent=curl||"All contests";
  if($("setPasscodeBtn")) $("setPasscodeBtn").style.display = curl ? "inline-block" : "none";
  const search = encodeURIComponent($("filter").value.trim());
  const candUrl = api()+"/candidates?page="+currentPage+"&search="+search+q;
  
  let eventsUrl = api()+"/events?limit=100"+q;
  if (selectedCandidateId) {
    eventsUrl += "&candidateId=" + encodeURIComponent(selectedCandidateId);
  }
  
  const [h,s,c,e]=await Promise.all([
   fetch(api()+"/health"),
   fetch(api()+"/summary?"+q.replace(/^&/,""),{headers:headers()}),
   fetch(candUrl,{headers:headers()}),
   fetch(eventsUrl,{headers:headers()})
  ]);
  const health=await h.json();
  $("health").textContent=health.status==="ok"?"Backend online":"Backend error";
  
  const candData = await c.json();
  candidates = candData.items || [];
  totalCandidates = candData.total || 0;
  
  events=await e.json();
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
 const list=candidates;
 $("rows").innerHTML=list.map(x=>{
  const cls=x.status==="ALERT"?"alert":x.status==="WARNING"?"warning":"normal";
  return `<tr><td><b><a href="#" onclick="filterByCandidate('${esc(x.candidateId)}'); return false;" style="color:#2563eb;text-decoration:none;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(x.candidateId)}</a></b></td>
  <td>${esc(x.studentName)}</td><td>${esc(x.studentRegId)}</td><td>${esc(x.hackerRankId)}</td>
  <td><span class="badge ${cls}">${x.status}</span></td>
  <td>${x.tabSwitches}</td><td>${x.escapes}</td><td>${x.fullscreenExits}</td><td>${x.navigatedAway}</td>
  <td>${x.focusLost}</td><td>${x.sessionStarts}</td><td><b>${x.reentries}</b></td>
  <td><b>${x.directReentries||0}</b></td>
  <td><b>${x.passcodeRejected||0}</b></td>
  <td class="muted">${x.lastSeen?new Date(x.lastSeen).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }):"-"}</td></tr>`
 }).join("")||`<tr><td colspan="15">No candidates found.</td></tr>`;
 
 updatePaginationUI();
}

function updatePaginationUI() {
  if (!$("pageInfo")) return;
  const start = (currentPage - 1) * 20 + 1;
  const end = Math.min(currentPage * 20, totalCandidates);
  $("pageInfo").textContent = totalCandidates > 0 ? `Showing ${start}-${end} of ${totalCandidates} candidates` : "Showing 0 candidates";
  $("prevPage").disabled = currentPage === 1;
  $("nextPage").disabled = end >= totalCandidates;
  $("prevPage").style.opacity = currentPage === 1 ? "0.5" : "1";
  $("nextPage").style.opacity = end >= totalCandidates ? "0.5" : "1";
}

function changePage(delta) {
  currentPage += delta;
  if (currentPage < 1) currentPage = 1;
  load();
}

function onSearch() {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    currentPage = 1;
    load();
  }, 400);
}

function filterByCandidate(cid) {
  selectedCandidateId = cid;
  if($("eventSubtitle")) $("eventSubtitle").textContent = `Showing events for candidate: ${cid}`;
  if($("clearEventFilterBtn")) $("clearEventFilterBtn").style.display = "inline-block";
  $("events").scrollIntoView({behavior: "smooth"});
  load();
}

function clearEventFilter() {
  selectedCandidateId = null;
  if($("eventSubtitle")) $("eventSubtitle").textContent = "Latest 100 events for selected contest";
  if($("clearEventFilterBtn")) $("clearEventFilterBtn").style.display = "none";
  load();
}

function renderEvents(){
 $("events").innerHTML=events.map(x=>`<tr><td class="muted">${new Date(x.timestamp).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
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
    } else {
      $("loginError").textContent = "Invalid Admin Key";
      $("loginError").style.display = "block";
    }
  } catch(e) {
    $("loginError").textContent = "Backend offline";
    $("loginError").style.display = "block";
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if($("loginOverlay")) $("loginOverlay").style.display = "none";
  if($("key") && !$("key").value) $("key").value = "test-admin-key";
  await loadContests();
  await fetchTrackingStatus();
  await load();
});


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

