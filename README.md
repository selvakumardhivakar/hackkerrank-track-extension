# HackerRank Contest Monitor v3 — Direct Visit Detection + Multi-Contest Admin

## What changed

### 1. Direct HackerRank visit detection

After a candidate starts monitoring through the extension, the extension continues watching the configured HackerRank contest URL.

Example:

1. Candidate clicks **Start / Login to Contest** in the extension.
2. Candidate presses Escape.
3. Fullscreen exit is recorded.
4. Candidate leaves the contest.
5. Candidate later opens the same HackerRank contest URL directly, without clicking the extension.
6. The extension detects the return and records:

`CONTEST_DIRECT_REENTRY`

The admin dashboard counts this separately as **Direct returns** and also includes it in the overall **Re-entries** count.

### 2. Admin contest URL filter

The admin page has a **HackerRank Contest URL — filter** field.

Paste, for example:

`https://www.hackerrank.com/test-1787062056`

and click **Apply filter**.

All metrics, candidates and recent events are filtered to that exact contest URL.

The **Contest preset** dropdown is populated from contest URLs already present in the database.

### 3. Candidate table

The table now includes:

- Start
- Re-entry
- Direct return
- Tab switches
- Escape
- Fullscreen exit
- Away
- Focus loss
- Last seen
- Risk status

## Run backend

```powershell
cd backend
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
$env:ADMIN_KEY="test-admin-key"
uvicorn main:app --reload --port 8000
```

If PowerShell blocks activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\venv\Scripts\Activate.ps1
```

## Run admin UI

In a second terminal:

```powershell
cd frontend
python -m http.server 5500
```

Open:

`http://localhost:5500`

## Load extension

Open:

`chrome://extensions`

Enable Developer mode -> Load unpacked -> select the `extension` folder.

Configure the exact HackerRank contest URL, candidate ID and API endpoint.

## Important limitation

A normal Chrome extension cannot guarantee detection when the extension is disabled, Chrome is completely closed, the browser profile is changed, or the operating system prevents extension execution. It also cannot reliably intercept every OS-level shortcut such as Alt+Tab.

The direct-visit detection works while the extension is installed/enabled and its service worker can run. It detects the configured HackerRank contest URL independently of clicking the extension popup.

This project is intended for authorized contest/integrity monitoring with appropriate candidate notice and institutional approval.


## Esc fullscreen warning + passcode

The extension now adds a fullscreen-exit warning on the HackerRank contest page.

When Escape is pressed while the page is fullscreen:
- `ESCAPE_KEY` is recorded.
- The extension attempts to capture Escape with the Keyboard Lock API when supported.
- A warning dialog is shown.
- An invigilator passcode is verified by the backend.
- Accepted/rejected passcode attempts are audited.
- The passcode is NOT stored in the extension.

### Configure the passcode

Create a SHA-256 hash of the desired passcode.

PowerShell example:

```powershell
$bytes = [Text.Encoding]::UTF8.GetBytes("YOUR_PASSCODE")
$hash = [Security.Cryptography.SHA256]::Create().ComputeHash($bytes)
-join ($hash | ForEach-Object { $_.ToString("x2") })
```

Then set the backend environment variable:

```powershell
$env:EXAM_PASSCODE_SHA256="<generated-hash>"
```

Start the backend:

```powershell
$env:ADMIN_KEY="test-admin-key"
$env:EXAM_PASSCODE_SHA256="<generated-hash>"
uvicorn main:app --reload --port 8000
```

For Vercel, set `EXAM_PASSCODE_SHA256` in Project Settings → Environment Variables.

### Important browser limitation

A normal Chrome extension cannot absolutely block every browser-level Escape/fullscreen exit. Chrome can provide an escape mechanism even when keyboard locking is used. The implementation is therefore **best-effort** and records attempts rather than claiming an unbreakable secure-exam browser.

Use this only for an authorized examination and inform candidates that fullscreen and integrity events are being monitored.


## Important: Chrome fullscreen X button

The Chrome fullscreen **X / exit control is browser chrome**, not part of the HackerRank webpage. A normal extension/content script cannot intercept that click before Chrome exits fullscreen.

This version handles it using the `fullscreenchange` event:

1. Student clicks the Chrome fullscreen X.
2. Fullscreen exits.
3. `PAGE_FULLSCREEN_EXIT` is logged.
4. The warning/passcode dialog appears on the contest page.
5. A valid invigilator passcode authorizes the exit.
6. If the student was not authorized, the exit remains flagged.
7. After authorization, the page attempts to re-enter fullscreen.

This is intentionally best-effort because Chrome controls the browser-level fullscreen UI.


## v6 visual warnings

### Fullscreen X / exit

The browser's fullscreen X is browser chrome and cannot be intercepted before Chrome performs the exit. The page now:
- shows a persistent red `EXAM MONITORING` banner while fullscreen;
- detects the fullscreen X via `fullscreenchange`;
- records `PAGE_FULLSCREEN_EXIT`;
- shows a centered red warning;
- opens the invigilator passcode dialog.

### Tab/window switching

The page listens for `visibilitychange`, `blur`, and `focus`. When a candidate returns after the page was hidden, it shows a centered red:

`⚠️ Screen / Tab Switch Detected`

and records the visibility/focus events. The background extension continues to record `TAB_SWITCH_AWAY` and related events.

Browser/OS-level shortcuts that completely prevent the page from running cannot be guaranteed to be observable by a normal web extension.
