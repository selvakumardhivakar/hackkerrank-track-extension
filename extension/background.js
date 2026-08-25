importScripts("env.js");

const DEFAULTS = {
  contestUrl: "",
  candidateId: "",
  studentName: "",
  studentRegId: "",
  hackerRankId: "",
  enabled: true,
};

async function cfg() {
  return await chrome.storage.local.get(DEFAULTS);
}

function normalizeUrl(value) {
  try {
    if (!/^https?:\/\//i.test(value)) value = "https://" + value;
    return new URL(value).href;
  } catch {
    return value;
  }
}

function sameContest(url, target) {
  try {
    const a = new URL(url),
      b = new URL(normalizeUrl(target));
    return (
      a.origin === b.origin &&
      a.pathname.startsWith(b.pathname.replace(/\/+$/, ""))
    );
  } catch {
    return false;
  }
}

let recordPromise = Promise.resolve();

async function record(eventType, details = {}) {
  const c = await cfg();
  if (!c.enabled || !c.candidateId) return;

  const event = {
    candidateId: c.candidateId,
    contestUrl: normalizeUrl(c.contestUrl),
    eventType,
    timestamp: new Date().toISOString(),
    details: {
      ...details,
      studentName: c.studentName || "",
      studentRegId: c.studentRegId || "",
      hackerRankId: c.hackerRankId || "",
    },
  };

  recordPromise = recordPromise
    .then(async () => {
      const local = await chrome.storage.local.get({ events: [] });
      await chrome.storage.local.set({
        events: [...local.events, event].slice(-1000),
      });

      if (typeof API_ENDPOINT !== "undefined" && API_ENDPOINT) {
        const queueData = await chrome.storage.local.get({
          unsyncedEvents: [],
        });
        const unsynced = [...queueData.unsyncedEvents, event];
        await chrome.storage.local.set({ unsyncedEvents: unsynced });

        if (unsynced.length >= 5) {
          flushEvents();
        }
      }
    })
    .catch(() => {});

  await recordPromise;
}

let isFlushing = false;
async function flushEvents() {
  if (typeof API_ENDPOINT === "undefined" || !API_ENDPOINT) return;
  if (isFlushing) return;
  isFlushing = true;

  try {
    const data = await chrome.storage.local.get({ unsyncedEvents: [] });
    const batch = data.unsyncedEvents.slice(0, 5);
    if (batch.length === 0) return;

    // Ensure no duplicate events within the payload
    const uniqueBatch = [];
    const seen = new Set();
    for (const e of batch) {
      const key = e.eventType + "_" + e.timestamp;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueBatch.push(e);
      }
    }

    const res = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(uniqueBatch),
      keepalive: true,
    });

    if (res.ok) {
      await new Promise((resolve) => {
        recordPromise = recordPromise
          .then(async () => {
            try {
              const latest = await chrome.storage.local.get({
                unsyncedEvents: [],
              });
              const remaining = latest.unsyncedEvents.slice(batch.length);
              await chrome.storage.local.set({ unsyncedEvents: remaining });
            } finally {
              resolve();
            }
          })
          .catch(resolve);
      });
    }
  } catch (_) {
  } finally {
    isFlushing = false;
    const after = await chrome.storage.local.get({ unsyncedEvents: [] });
    if (after.unsyncedEvents.length >= 5) {
      setTimeout(flushEvents, 1000);
    }
  }
}

chrome.alarms.create("flushEvents", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "flushEvents") flushEvents();
});

/*
 * State used to distinguish:
 * 1. A contest opened by the extension.
 * 2. A later contest visit opened directly by the candidate.
 *
 * We persist this because MV3 service workers can be suspended/restarted.
 */
async function state() {
  return await chrome.storage.local.get({
    contestTabIds: [],
    extensionOpenedTabs: [],
    contestWasSeen: {},
    sessionStarted: false,
    activeTabIsContest: true,
    isWindowFocused: true,
  });
}

async function markContestSeen(tabId, url, source) {
  const s = await state();
  const key = String(tabId);
  const previous = s.contestWasSeen[key];

  s.contestWasSeen[key] = {
    url,
    lastSeenAt: new Date().toISOString(),
    source,
  };

  await chrome.storage.local.set({ contestWasSeen: s.contestWasSeen });
  return previous;
}

async function handleContestLoaded(tab, source = "browser") {
  const c = await cfg();
  if (!sameContest(tab.url || "", c.contestUrl)) return;

  const s = await state();
  const tabId = String(tab.id);
  const previous = s.contestWasSeen[tabId];

  // A tab was opened through our Start button. Its first load is not a re-entry.
  const extensionOpened = s.extensionOpenedTabs.includes(tab.id);

  // If monitoring has already started and this contest is encountered again
  // without being opened through the extension, record a direct re-entry.
  if (s.sessionStarted && !extensionOpened) {
    const isNewDirectVisit =
      !previous || previous.url === null || previous.leftContest === true;
    if (isNewDirectVisit) {
      await record("CONTEST_DIRECT_REENTRY", {
        mode: "direct_browser_visit",
        tabId: tab.id,
        url: tab.url || "",
        detection: source,
      });
    }
  }

  await markContestSeen(tab.id, tab.url || "", "contest");
}

async function getContestTab() {
  const c = await cfg();
  const tabs = await chrome.tabs.query({});
  return tabs.find((t) => sameContest(t.url || "", c.contestUrl));
}

/*
 * Browser fullscreen is browser UI state. There is no page event for it.
 * Poll the actual Chrome window state while a contest tab is present.
 */
let lastWindowState = {};
async function pollBrowserState() {
  const c = await cfg();
  if (!c.enabled) return;
  const tab = await getContestTab();
  if (!tab) return;

  try {
    const w = await chrome.windows.get(tab.windowId);
    const previous = lastWindowState[tab.windowId];

    if (previous === "fullscreen" && w.state !== "fullscreen") {
      await record("BROWSER_FULLSCREEN_EXIT", {
        windowId: w.id,
        newState: w.state,
      });
    }

    if (previous !== "fullscreen" && w.state === "fullscreen") {
      await record("BROWSER_FULLSCREEN_ENTER", {
        windowId: w.id,
        source: "state_poll",
      });
    }

    lastWindowState[tab.windowId] = w.state;
  } catch (_) {}
}
setInterval(pollBrowserState, 1000);

let _tabLock = false;
let _focusLock = false;

chrome.tabs.onActivated.addListener(async ({ tabId, windowId }) => {
  while (_tabLock) await new Promise((r) => setTimeout(r, 10));
  _tabLock = true;
  try {
    const c = await cfg();
    const tab = await chrome.tabs.get(tabId);
    const s = await state();

    if (sameContest(tab.url || "", c.contestUrl)) {
      await chrome.storage.local.set({ activeTabIsContest: true });
      await handleContestLoaded(tab, "tab_activation");
      await record("CONTEST_TAB_ACTIVE", { windowId, tabId });
    } else {
      await record("TAB_SWITCH_AWAY", {
        windowId,
        tabId,
        url: tab.url || "",
        title: tab.title || "",
      });
      if (s.activeTabIsContest) {
        await chrome.storage.local.set({ activeTabIsContest: false });
      }

      const key = String(tabId);
      if (s.contestWasSeen[key]) {
        s.contestWasSeen[key].leftContest = true;
        await chrome.storage.local.set({ contestWasSeen: s.contestWasSeen });
      }
    }
  } catch (_) {
  } finally {
    _tabLock = false;
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  while (_focusLock) await new Promise((r) => setTimeout(r, 10));
  _focusLock = true;
  try {
    const s = await state();

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      if (s.isWindowFocused) {
        await record("BROWSER_FOCUS_LOST");
        await chrome.storage.local.set({ isWindowFocused: false });
      }
      return;
    }

    if (!s.isWindowFocused) {
      await chrome.storage.local.set({ isWindowFocused: true });
    }

    const c = await cfg();
    const tabs = await chrome.tabs.query({ windowId });
    const contest = tabs.find((t) => sameContest(t.url || "", c.contestUrl));

    if (contest) {
      await handleContestLoaded(contest, "window_focus");
      await record("BROWSER_FOCUS_GAINED", { windowId });
    }
  } catch (_) {
  } finally {
    _focusLock = false;
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  try {
    const c = await cfg();
    const isContest = sameContest(tab.url || "", c.contestUrl);

    if (!isContest) {
      if (changeInfo.url) {
        await record("NAVIGATED_AWAY", { tabId, url: changeInfo.url });
      }

      const s = await state();
      const key = String(tabId);
      if (changeInfo.url && s.contestWasSeen[key]) {
        s.contestWasSeen[key].leftContest = true;
        await chrome.storage.local.set({ contestWasSeen: s.contestWasSeen });
      }
      return;
    }

    if (changeInfo.status === "complete" || changeInfo.url) {
      await handleContestLoaded(tab, "tab_update");
      await record("CONTEST_PAGE_LOADED", { tabId, url: tab.url || "" });
    }
  } catch (_) {}
});

chrome.tabs.onCreated.addListener(async (tab) => {
  try {
    const c = await cfg();
    if (sameContest(tab.url || "", c.contestUrl)) {
      await handleContestLoaded(tab, "tab_created");
    }
  } catch (_) {}
});

chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  try {
    const s = await state();

    if (s.contestTabIds.includes(tabId)) {
      await record("CONTEST_TAB_CLOSED", { tabId, windowId: info.windowId });
    }

    await chrome.storage.local.set({
      contestTabIds: s.contestTabIds.filter((x) => x !== tabId),
      extensionOpenedTabs: s.extensionOpenedTabs.filter((x) => x !== tabId),
    });

    delete s.contestWasSeen[String(tabId)];
    await chrome.storage.local.set({ contestWasSeen: s.contestWasSeen });
  } catch (_) {}
});

async function verifyFullscreenPasscode(passcode) {
  const c = await cfg();
  const FALLBACK_PASSCODE = "K@runy@#2";
  try {
    const response = await fetch(
      API_ENDPOINT.replace(/\/events\/?$/, "/verify-passcode"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: c.candidateId,
          contestUrl: normalizeUrl(c.contestUrl),
          passcode,
        }),
      },
    );
    if (!response.ok && response.status >= 500) {
      throw new Error("Backend server error");
    }
    const data = await response.json();
    return {
      ok: response.ok && data.ok === true,
      message:
        data.message ||
        (response.ok ? "Passcode rejected." : "Server verification failed."),
    };
  } catch (e) {
    if (passcode === FALLBACK_PASSCODE) {
      return {
        ok: true,
        message: "Fallback passcode accepted (Backend offline).",
      };
    }
    return {
      ok: false,
      message: "Unable to reach backend. Fallback passcode rejected.",
    };
  }
}

chrome.runtime.onMessage.addListener((m, s, r) => {
  if (m.type === "OPEN_CONTEST") {
    (async () => {
      const c = await cfg();
      const contestUrl = normalizeUrl(c.contestUrl);

      const tab = await chrome.tabs.create({
        url: contestUrl,
        active: true,
      });

      const st = await state();

      await chrome.storage.local.set({
        contestTabIds: [...new Set([...st.contestTabIds, tab.id])],
        extensionOpenedTabs: [...new Set([...st.extensionOpenedTabs, tab.id])],
        sessionStarted: true,
      });

      await record("CONTEST_SESSION_START", {
        mode: "extension_start",
        tabId: tab.id,
      });

      try {
        await chrome.windows.update(tab.windowId, { state: "fullscreen" });
        await record("BROWSER_FULLSCREEN_ENTER", {
          windowId: tab.windowId,
          source: "extension_start",
        });
      } catch (e) {
        await record("BROWSER_FULLSCREEN_FAILED", { error: String(e) });
      }

      r({ ok: true });
    })();
    return true;
  }

  if (m.type === "REENTER_CONTEST") {
    (async () => {
      const c = await cfg();
      const contestUrl = normalizeUrl(c.contestUrl);

      let tab = s.tab;

      if (!tab) {
        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        tab = tabs[0];
      }

      if (!tab) {
        r({ ok: false, error: "No active tab" });
        return;
      }

      if (!sameContest(tab.url || "", c.contestUrl)) {
        tab = await chrome.tabs.create({
          url: contestUrl,
          active: true,
        });
      }

      await record("CONTEST_SESSION_REENTRY", {
        mode: "extension_reentry",
        tabId: tab.id,
      });

      try {
        await chrome.windows.update(tab.windowId, { state: "fullscreen" });
        await record("BROWSER_FULLSCREEN_REENTER", {
          windowId: tab.windowId,
          source: "extension_reentry",
        });
      } catch (e) {
        await record("BROWSER_FULLSCREEN_FAILED", { error: String(e) });
      }

      const st = await state();
      await chrome.storage.local.set({
        sessionStarted: true,
        contestTabIds: [...new Set([...st.contestTabIds, tab.id])],
        extensionOpenedTabs: [...new Set([...st.extensionOpenedTabs, tab.id])],
      });

      r({ ok: true });
    })();
    return true;
  }

  if (m.type === "VERIFY_FULLSCREEN_PASSCODE") {
    (async () => {
      const result = await verifyFullscreenPasscode(m.passcode);
      if (result.ok) {
        await record("FULLSCREEN_PASSCODE_ACCEPTED", {
          tabId: s.tab?.id || null,
        });

        if (s.tab) {
          try {
            await chrome.windows.update(s.tab.windowId, {
              state: "fullscreen",
            });
          } catch (e) {
            await record("BROWSER_FULLSCREEN_FAILED", { error: String(e) });
          }
        }
      } else {
        await record("FULLSCREEN_PASSCODE_REJECTED", {
          tabId: s.tab?.id || null,
        });
      }
      r(result);
    })();
    return true;
  }

  if (m.type === "CONTEST_EVENT") {
    record(m.eventType, {
      ...(m.details || {}),
      pageUrl: s.tab?.url || "",
      tabId: s.tab?.id || null,
    });
    r({ ok: true });
    return true;
  }
});

// On service-worker startup, inspect currently open tabs.
// This allows direct contest visits to be detected even after the
// extension worker was restarted.
(async () => {
  flushEvents();
  try {
    const c = await cfg();
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (sameContest(tab.url || "", c.contestUrl)) {
        await handleContestLoaded(tab, "startup_scan");
      }
    }
  } catch (_) {}
})();
