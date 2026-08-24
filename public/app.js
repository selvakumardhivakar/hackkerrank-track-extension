let candidates = [],
  events = [],
  contests = [];
let isTracking = true;
let currentPage = 1;
let totalCandidates = 0;
let searchTimer = null;
let selectedCandidateId = null;
const $ = (id) => document.getElementById(id);
function api() {
  return $("api").value.replace(/\/$/, "");
}
function headers() {
  return { "x-admin-key": $("key").value.trim() };
}
function contestParam() {
  const v = $("contestUrl").value.trim();
  const strict = $("strictHr") && $("strictHr").checked;
  const aiSort = $("aiFilter") && $("aiFilter").checked;
  let q = "";
  if (v) q += `&contestUrl=${encodeURIComponent(v)}`;
  if (strict) q += `&strictHr=true`;
  if (aiSort) q += `&aiSort=true`;
  return q;
}
async function loadContests() {
  try {
    const r = await fetch(api() + "/contests", { headers: headers() });
    contests = await r.json();
    $("contestPreset").innerHTML =
      '<option value="">All contests</option>' +
      contests
        .map(
          (c) =>
            `<option value="${escAttr(c.contestUrl)}">${esc(c.contestUrl)} (${c.students})</option>`,
        )
        .join("");
  } catch (e) {
    console.error(e);
  }
}
function choosePreset() {
  $("contestUrl").value = $("contestPreset").value;
  load();
}
function applyFilter() {
  currentPage = 1;
  load();
}
function clearFilter() {
  $("contestUrl").value = "";
  $("contestPreset").value = "";
  $("filter").value = "";
  currentPage = 1;
  load();
}
function esc(s) {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        m
      ],
  );
}
function escAttr(s) {
  return esc(s);
}

function showLoader() {
  const spinHtml = `<div class="inline-block w-5 h-5 border-2 border-theme-border border-t-brand-500 rounded-full animate-spin"></div>`;
  $("rows").innerHTML =
    `<tr><td colspan="15" class="text-center py-8 text-theme-text-muted">${spinHtml} <span class="align-super ml-2 font-medium">Loading candidates...</span></td></tr>`;
  $("events").innerHTML =
    `<tr><td colspan="5" class="text-center py-8 text-theme-text-muted">${spinHtml} <span class="align-super ml-2 font-medium">Loading events...</span></td></tr>`;
}

async function load() {
  const c = $("contestUrl").value.trim();
  $("selectedContest").textContent = c || "All contests";
  if ($("setPasscodeBtn"))
    $("setPasscodeBtn").style.display = c ? "inline-block" : "none";

  fetchTrackingStatus();

  showLoader();
  try {
    const q = contestParam();
    const search = encodeURIComponent($("filter").value.trim());
    const candUrl =
      api() + "/candidates?page=" + currentPage + "&search=" + search + q;

    let eventsUrl = api() + "/events?limit=100" + q;
    if (selectedCandidateId) {
      eventsUrl += "&candidateId=" + encodeURIComponent(selectedCandidateId);
    }

    const [h, s, c, e] = await Promise.all([
      fetch(api() + "/health"),
      fetch(api() + "/summary?" + q.replace(/^&/, ""), { headers: headers() }),
      fetch(candUrl, { headers: headers() }),
      fetch(eventsUrl, { headers: headers() }),
    ]);
    const health = await h.json();
    $("health").textContent =
      health.status === "ok" ? "Backend online" : "Backend error";

    const candData = await c.json();
    candidates = candData.items || [];
    totalCandidates = candData.total || 0;

    events = await e.json();
    const sum = await s.json();
    $("students").textContent = sum.students || 0;
    $("switches").textContent = sum.tabSwitches || 0;
    $("escapes").textContent = sum.escapes || 0;
    $("exits").textContent = sum.browserFullscreenExits || 0;
    $("reentries").textContent = sum.reentries || 0;
    $("directReentries").textContent = sum.directReentries || 0;
    $("passcodeRejected").textContent = sum.passcodeRejected || 0;
    if($("aiSearches")) $("aiSearches").textContent = sum.aiSearches || 0;
    $("dot").style.background = "#22c55e";
    render();
    renderEvents();
  } catch (err) {
    $("health").textContent = "Backend offline";
    $("dot").style.background = "#ef4444";
    console.error(err);
  }
}
function render() {
  const list = candidates;
  $("rows").innerHTML =
    list
      .map((x) => {
        let cls = "";
        if (x.status === "ALERT")
          cls = "bg-rose-500/10 text-rose-500 border border-rose-500/20";
        else if (x.status === "WARNING")
          cls = "bg-amber-500/10 text-amber-500 border border-amber-500/20";
        else
          cls =
            "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20";

        return `<tr class="hover:bg-theme-surface-hover transition-colors group">
  <td class="px-5 py-3 font-semibold text-theme-text group-hover:text-brand-500 transition-colors"><a href="#" onclick="filterByCandidate('${esc(x.candidateId)}'); return false;">${esc(x.candidateId)}</a></td>
  <td class="px-5 py-3 text-theme-text-secondary">${esc(x.studentName)}</td>
  <td class="px-5 py-3 text-theme-text-secondary font-mono text-xs">${esc(x.studentRegId)}</td>
  <td class="px-5 py-3 text-theme-text-secondary font-mono text-xs">${esc(x.hackerRankId)}</td>
  <td class="px-5 py-3"><span class="px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${cls}">${x.status}</span></td>
  <td class="px-5 py-3 text-center ${x.tabSwitches > 0 ? "text-rose-500 font-bold" : "text-theme-text-muted"}">${x.tabSwitches}</td>
  <td class="px-5 py-3 text-center ${x.escapes > 0 ? "text-amber-500 font-bold" : "text-theme-text-muted"}">${x.escapes}</td>
  <td class="px-5 py-3 text-center ${x.fullscreenExits > 0 ? "text-orange-500 font-bold" : "text-theme-text-muted"}">${x.fullscreenExits}</td>
  <td class="px-5 py-3 text-center ${x.navigatedAway > 0 ? "text-rose-500 font-bold" : "text-theme-text-muted"}">${x.navigatedAway}</td>
  <td class="px-5 py-3 text-center ${x.focusLost > 0 ? "text-amber-500 font-bold" : "text-theme-text-muted"}">${x.focusLost}</td>
  <td class="px-5 py-3 text-center ${x.aiSearches > 0 ? "text-red-600 font-bold bg-red-500/10" : "text-theme-text-muted"}">${x.aiSearches || 0}</td>
  <td class="px-5 py-3 text-center text-theme-text-secondary">${x.sessionStarts}</td>
  <td class="px-5 py-3 text-center font-bold text-emerald-500">${x.reentries}</td>
  <td class="px-5 py-3 text-center font-bold text-fuchsia-500">${x.directReentries || 0}</td>
  <td class="px-5 py-3 text-center font-bold ${x.passcodeRejected > 0 ? "text-red-500" : "text-theme-text-muted"}">${x.passcodeRejected || 0}</td>
  <td class="px-5 py-3 text-xs text-theme-text-muted">${x.lastSeen ? new Date(x.lastSeen).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "-"}</td></tr>`;
      })
      .join("") ||
    `<tr><td colspan="15" class="px-5 py-8 text-center text-theme-text-muted font-medium">No candidates found.</td></tr>`;

  updatePaginationUI();
}

function updatePaginationUI() {
  if (!$("pageInfo")) return;
  const start = (currentPage - 1) * 20 + 1;

  if (totalCandidates === -1) {
    const numItems = candidates.length;
    $("pageInfo").textContent =
      numItems > 0 ? `Showing page ${currentPage}` : "Showing 0 candidates";
    $("prevPage").disabled = currentPage === 1;
    $("nextPage").disabled = numItems < 20;
    $("prevPage").style.opacity = currentPage === 1 ? "0.5" : "1";
    $("nextPage").style.opacity = numItems < 20 ? "0.5" : "1";
  } else {
    const end = Math.min(currentPage * 20, totalCandidates);
    $("pageInfo").textContent =
      totalCandidates > 0
        ? `Showing ${start}-${end} of ${totalCandidates} candidates`
        : "Showing 0 candidates";
    $("prevPage").disabled = currentPage === 1;
    $("nextPage").disabled = end >= totalCandidates;
    $("prevPage").style.opacity = currentPage === 1 ? "0.5" : "1";
    $("nextPage").style.opacity = end >= totalCandidates ? "0.5" : "1";
  }
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
  if ($("eventSubtitle"))
    $("eventSubtitle").textContent = `Showing events for candidate: ${cid}`;
  if ($("clearEventFilterBtn"))
    $("clearEventFilterBtn").style.display = "inline-block";
  $("events").scrollIntoView({ behavior: "smooth" });
  load();
}

function clearEventFilter() {
  selectedCandidateId = null;
  if ($("eventSubtitle"))
    $("eventSubtitle").textContent = "Latest 100 events for selected contest";
  if ($("clearEventFilterBtn")) $("clearEventFilterBtn").style.display = "none";
  load();
}

function renderEvents() {
  $("events").innerHTML =
    events
      .map(
        (x) => `<tr class="hover:bg-theme-surface-hover transition-colors">
 <td class="px-5 py-3 text-xs text-theme-text-muted font-mono">${new Date(x.timestamp).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
 <td class="px-5 py-3 font-semibold text-theme-text">${esc(x.candidateId)}</td>
 <td class="px-5 py-3 text-xs text-indigo-500 dark:text-indigo-400 font-mono" title="${esc(x.contestUrl)}">${esc(x.contestUrl)}</td>
 <td class="px-5 py-3"><span class="px-2 py-1 bg-theme-surface-alt text-brand-500 rounded text-[10px] font-bold uppercase tracking-wider border border-theme-border">${esc(x.eventType)}</span></td>
 <td class="px-5 py-3 text-xs text-theme-text-muted font-mono" title='${esc(JSON.stringify(x.details || {}))}'>${esc(JSON.stringify(x.details || {}))}</td>
 </tr>`,
      )
      .join("") ||
    `<tr><td colspan="5" class="px-5 py-8 text-center text-theme-text-muted font-medium">No recent events found.</td></tr>`;
}

async function login() {
  const k = $("loginKey").value;
  $("key").value = k;
  try {
    const res = await fetch(api() + "/contests", { headers: headers() });
    if (res.ok) {
      $("loginOverlay").style.display = "none";
      await loadContests();
      await fetchTrackingStatus();
      await load();
    } else {
      $("loginError").textContent = "Invalid Admin Key";
      $("loginError").style.display = "block";
    }
  } catch (e) {
    $("loginError").textContent = "Backend offline";
    $("loginError").style.display = "block";
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  if ($("loginOverlay")) $("loginOverlay").style.display = "none";
  if ($("key") && !$("key").value) $("key").value = "test-admin-key";
  await loadContests();
  await fetchTrackingStatus();
  await load();
});

async function exportCSV() {
  const btn =
    $("exportBtn") || document.querySelector("button[onclick='exportCSV()']");
  const origText = btn ? btn.textContent : "Export CSV";
  if (btn) btn.textContent = "Exporting...";

  try {
    const q = contestParam();
    const search = encodeURIComponent($("filter").value.trim());
    // Fetch all candidates with a huge limit
    const candUrl =
      api() + "/candidates?page=1&limit=1000000&search=" + search + q;

    const res = await fetch(candUrl, { headers: headers() });
    if (!res.ok) throw new Error("Failed to fetch candidates");

    const data = await res.json();
    const fullCandidatesList = data.candidates || [];

    if (!fullCandidatesList.length) {
      alert("No candidates to export.");
      return;
    }

    const csvHeaders = [
      "Candidate ID",
      "Name",
      "Reg ID",
      "HackerRank ID",
      "Status",
      "Tab Switches",
      "Escapes",
      "FS Exits",
      "Nav Away",
      "Focus Lost",
      "AI Searches",
      "Session Starts",
      "Re-entries",
      "Direct Returns",
      "Passcode Rejects",
      "Last Seen",
    ];
    const rows = fullCandidatesList.map((x) => [
      x.candidateId,
      x.studentName || "",
      x.studentRegId || "",
      x.hackerRankId || "",
      x.status,
      x.tabSwitches,
      x.escapes,
      x.fullscreenExits,
      x.navigatedAway,
      x.focusLost,
      x.aiSearches || 0,
      x.sessionStarts,
      x.reentries,
      x.directReentries || 0,
      x.passcodeRejected || 0,
      x.lastSeen,
    ]);
    const csvContent = [
      csvHeaders.join(","),
      ...rows.map((e) =>
        e.map((f) => `"${String(f).replace(/"/g, '""')}"`).join(","),
      ),
    ].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", "contest_monitor_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } catch (e) {
    console.error(e);
    alert("Error exporting CSV");
  } finally {
    if (btn) btn.textContent = origText;
  }
}

function setContestPasscode() {
  const url = $("contestUrl").value.trim();
  if (!url) {
    alert("Please select a specific contest first.");
    return;
  }
  const passcode = prompt(
    "Enter new passcode for contest:\n" + url + "\n\n(Leave empty to cancel)",
  );
  if (!passcode) return;

  fetch(api() + "/contests/passcode", {
    method: "POST",
    headers: Object.assign({}, headers(), {
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({ contestUrl: url, passcode: passcode }),
  })
    .then((r) => r.json())
    .then((data) => {
      if (data.ok) alert("Passcode updated successfully for this contest!");
      else alert(data.message || "Failed to update passcode.");
    })
    .catch((e) => {
      console.error(e);
      alert("Error updating passcode.");
    });
}

async function fetchTrackingStatus() {
  const curl = $("contestUrl").value.trim();
  if (!curl) {
    if ($("trackingToggleBtn")) $("trackingToggleBtn").style.display = "none";
    return;
  }

  try {
    const q = curl ? "?contestUrl=" + encodeURIComponent(curl) : "";
    const r = await fetch(api() + "/settings/tracking" + q, {
      headers: headers(),
    });
    if (r.ok) {
      const data = await r.json();
      isTracking = data.tracking_enabled;
      updateTrackingBtn();
    }
  } catch (e) {
    console.error(e);
  }
}

function updateTrackingBtn() {
  const btn = $("trackingToggleBtn");
  if (!btn) return;

  const curl = $("contestUrl").value.trim();
  if (!curl) {
    btn.style.display = "none";
    return;
  }

  btn.style.display = "inline-block";
  if (isTracking) {
    btn.textContent = "Stop Tracking";
    btn.className =
      "px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-red-500/20";
  } else {
    btn.textContent = "Start Tracking";
    btn.className =
      "px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-brand-500/20";
  }
}

async function toggleTracking() {
  const curl = $("contestUrl").value.trim();
  if (!curl) {
    alert("Please select a contest first to toggle tracking.");
    return;
  }

  if (
    !confirm(
      `Are you sure you want to ${isTracking ? "STOP" : "START"} saving all incoming API events for ${curl}?`,
    )
  )
    return;

  try {
    const res = await fetch(api() + "/settings/tracking", {
      method: "POST",
      headers: Object.assign({}, headers(), {
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({ enabled: !isTracking, contestUrl: curl }),
    });
    const data = await res.json();
    if (data.ok) {
      isTracking = data.tracking_enabled;
      updateTrackingBtn();
    } else {
      alert("Failed to update tracking setting");
    }
  } catch (e) {
    console.error(e);
    alert("Error updating tracking setting");
  }
}
