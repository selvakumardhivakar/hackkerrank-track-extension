
(() => {
  if (window.top !== window) return;
  if (window.__karunyaMonitorLoaded) return;
  window.__karunyaMonitorLoaded = true;

  const EXIT_DIALOG_ID = "karunya-fullscreen-warning";
  const STATUS_ID = "karunya-integrity-banner";
  let authorizedExit = false;
  let suppressExitDialogUntil = 0;
  let tabAwayShown = false;

  function post(type, details = {}) {
    try {
      chrome.runtime.sendMessage({
        type: "CONTEST_EVENT",
        eventType: type,
        details
      });
    } catch (_) {}
  }

  function remove(id) {
    document.getElementById(id)?.remove();
  }

  function showFullscreenBanner() {
    if (document.getElementById(STATUS_ID)) return;

    const el = document.createElement("div");
    el.id = STATUS_ID;
    Object.assign(el.style, {
      position:"fixed",
      top:"12px",
      left:"50%",
      transform:"translateX(-50%)",
      zIndex:"2147483646",
      background:"rgba(153, 27, 27, .96)",
      color:"#fff",
      padding:"8px 18px",
      borderRadius:"999px",
      font:"600 13px Arial,sans-serif",
      boxShadow:"0 4px 16px rgba(0,0,0,.25)",
      pointerEvents:"none",
      letterSpacing:".1px"
    });
    el.textContent="HACKERRANK CONTEST TRACKING • Fullscreen required • Exit attempts are recorded";
    document.documentElement.appendChild(el);
  }

  function showCenterWarning(title, message, kind="red") {
    remove("karunya-center-warning");

    const overlay=document.createElement("div");
    overlay.id="karunya-center-warning";
    Object.assign(overlay.style,{
      position:"fixed",inset:"0",zIndex:"2147483647",
      background:"rgba(10,10,10,.68)",
      display:"flex",alignItems:"center",justifyContent:"center",
      fontFamily:"Arial,sans-serif"
    });

    const box=document.createElement("div");
    Object.assign(box.style,{
      width:"min(500px,calc(100vw - 48px))",
      boxSizing:"border-box",
      background:"#fff",
      borderTop:`7px solid ${kind==="red" ? "#d92d20" : "#344054"}`,
      borderRadius:"14px",
      padding:"28px 30px",
      boxShadow:"0 25px 80px rgba(0,0,0,.45)",
      color:"#101828",
      textAlign:"center"
    });

    box.innerHTML=`
      <div style="width:54px;height:54px;border-radius:50%;background:#fee4e2;color:#b42318;display:flex;align-items:center;justify-content:center;font-size:28px;margin:0 auto 14px">!</div>
      <div style="font-size:24px;font-weight:800;margin-bottom:10px">${title}</div>
      <div style="font-size:15px;line-height:1.6;color:#475467">${message}</div>
      <div style="margin-top:18px;font-size:12px;font-weight:700;color:#b42318">
        This event has been recorded by Contest Tracking.
      </div>
    `;

    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    // Automatically clear after a short interval, but keep the event logged.
    setTimeout(()=>remove("karunya-center-warning"), 3500);
  }

  function showPasscodeDialog(reason) {
    if (Date.now() < suppressExitDialogUntil) return;
    if (document.getElementById(EXIT_DIALOG_ID)) {
      document.getElementById("karunya-passcode")?.focus();
      return;
    }

    post("PASSCODE_WARNING_SHOWN",{reason});

    let title = "Fullscreen Exit Detected";
    let message = "Fullscreen is required for this examination. The exit attempt has been recorded. An authorized invigilator must enter the passcode to continue.";

    if (reason === "tab_switch") {
      title = "Screen / Tab Switch Detected";
      message = "You switched away from the examination window. This event has been recorded. An authorized invigilator must enter the passcode to continue.";
    }

    const overlay=document.createElement("div");
    overlay.id=EXIT_DIALOG_ID;
    Object.assign(overlay.style,{
      position:"fixed",inset:"0",zIndex:"2147483647",
      background:"rgba(0,0,0,.78)",
      display:"flex",alignItems:"center",justifyContent:"center",
      fontFamily:"Arial,sans-serif"
    });

    const box=document.createElement("div");
    Object.assign(box.style,{
      width:"min(450px,calc(100vw - 40px))",
      background:"#fff",borderRadius:"14px",padding:"28px",
      boxShadow:"0 25px 80px rgba(0,0,0,.45)",color:"#101828"
    });

    box.innerHTML=`
      <div style="font-size:31px">⚠️</div>
      <h2 style="margin:8px 0">${title}</h2>
      <p style="font-size:14px;line-height:1.55;color:#475467">
        ${message}
      </p>
      <input id="karunya-passcode" type="password" autocomplete="off"
        placeholder="Invigilator passcode"
        style="width:100%;box-sizing:border-box;padding:12px;border:1px solid #d0d5dd;border-radius:8px;font-size:15px">
      <div id="karunya-passcode-error" style="display:none;color:#b42318;font-size:13px;margin-top:8px"></div>
      <button id="karunya-verify"
        style="width:100%;margin-top:12px;padding:12px;border:0;border-radius:8px;background:#111827;color:#fff;font-weight:700;cursor:pointer;">
        Verify & Continue
      </button>
    `;

    overlay.appendChild(box);
    document.documentElement.appendChild(overlay);

    const input=box.querySelector("#karunya-passcode");
    const button=box.querySelector("#karunya-verify");
    const error=box.querySelector("#karunya-passcode-error");

    const verify=()=>{
      if(!input.value){
        error.textContent="Enter the invigilator passcode.";
        error.style.display="block";
        return;
      }

      button.disabled=true;
      button.textContent="Verifying...";

      chrome.runtime.sendMessage({
        type:"VERIFY_FULLSCREEN_PASSCODE",
        passcode:input.value
      },response=>{
        if(chrome.runtime.lastError || !response?.ok){
          error.textContent=response?.message||"Invalid passcode.";
          error.style.display="block";
          button.disabled=false;
          button.textContent="Verify & Continue";
          input.select();
          return;
        }

        authorizedExit=true;
        suppressExitDialogUntil=Date.now()+3000;
        post("FULLSCREEN_PASSCODE_ACCEPTED",{reason});
        remove(EXIT_DIALOG_ID);

        // If X already exited fullscreen, attempt to restore it.
        if(!document.fullscreenElement){
          document.documentElement.requestFullscreen?.().then(()=>{
            post("PAGE_FULLSCREEN_REENTER_AFTER_AUTH");
          }).catch(()=>{
            post("PAGE_FULLSCREEN_REENTER_FAILED_AFTER_AUTH");
          });
        }
      });
    };

    button.onclick=verify;
    input.onkeydown=e=>{if(e.key==="Enter") verify();};
    setTimeout(()=>input.focus(),50);
  }

  // ESC key: best-effort interception while page fullscreen.
  document.addEventListener("keydown",e=>{
    if(e.key!=="Escape") return;

    post("ESCAPE_KEY",{});

    if(document.fullscreenElement){
      e.preventDefault();
      e.stopImmediatePropagation();
      showPasscodeDialog("escape");
    }
  },true);

  // Fullscreen state changes also detect the browser's fullscreen X.
  document.addEventListener("fullscreenchange",()=>{
    if(document.fullscreenElement){
      post("PAGE_FULLSCREEN_ENTER");
      showFullscreenBanner();
      remove(EXIT_DIALOG_ID);
      try{ navigator.keyboard?.lock?.(["Escape"]); }catch(_){}
      return;
    }

    remove(STATUS_ID);
    post("PAGE_FULLSCREEN_EXIT",{source:"fullscreenchange"});

    if(authorizedExit){
      authorizedExit=false;
      return;
    }

    showCenterWarning(
      "Fullscreen Exit Attempt",
      "You exited the exam fullscreen window. Please return to the exam window. Your exit has been recorded.",
      "red"
    );
    showPasscodeDialog("browser_fullscreen_exit_or_X");
  });

  // Visibility is the reliable page-level signal for tab/window switching.
  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="hidden"){
      post("PAGE_HIDDEN",{
        visibilityState:"hidden",
        pageUrl:location.href
      });
      tabAwayShown=false;
    }else{
      post("PAGE_VISIBLE",{
        visibilityState:"visible",
        pageUrl:location.href
      });

      // Show passcode overlay when the student returns.
      if(!tabAwayShown){
        tabAwayShown=true;
        showPasscodeDialog("tab_switch");
      }
    }
  });

  window.addEventListener("blur",()=>{
    post("WINDOW_BLUR");
  });

  window.addEventListener("focus",()=>{
    post("WINDOW_FOCUS");
  });

  // Warn on unload/navigation as another signal.
  window.addEventListener("beforeunload",()=>{
    post("PAGE_UNLOAD_ATTEMPT",{pageUrl:location.href});
  });

  if(document.fullscreenElement){
    showFullscreenBanner();
    try{ navigator.keyboard?.lock?.(["Escape"]); }catch(_){}
  }
})();
