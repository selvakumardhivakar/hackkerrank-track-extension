const $ = (id) => document.getElementById(id);

function normalizeContestUrl(value) {
  value = value.trim();

  if (!value) {
    throw new Error("Contest URL is required");
  }

  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }

  const url = new URL(value);

  if (url.hostname !== "www.hackerrank.com") {
    throw new Error("Only HackerRank contest URLs are allowed");
  }

  return url.href;
}

function validateInputs() {
  const isValid =
    $("contestUrl").value.trim() !== "" &&
    $("studentName").value.trim() !== "" &&
    $("studentRegId").value.trim() !== "" &&
    $("hackerRankId").value.trim() !== "";

  $("start").disabled = !isValid;
  $("reenter").disabled = !isValid;
}

(async () => {
  const c = await chrome.storage.local.get({
    contestUrl: "https://www.hackerrank.com/Karunya_12",
    studentName: "",
    studentRegId: "",
    hackerRankId: "",
  });

  $("contestUrl").value = c.contestUrl;
  $("studentName").value = c.studentName;
  $("studentRegId").value = c.studentRegId;
  $("hackerRankId").value = c.hackerRankId;

  validateInputs();
  ["contestUrl", "studentName", "studentRegId", "hackerRankId"].forEach(
    (id) => {
      $(id).addEventListener("input", validateInputs);
    },
  );
})();

async function save() {
  const contestUrl = normalizeContestUrl($("contestUrl").value);

  const regId = $("studentRegId").value.trim();

  await chrome.storage.local.set({
    contestUrl,
    candidateId: regId || "UNKNOWN",
    studentName: $("studentName").value.trim(),
    studentRegId: regId,
    hackerRankId: $("hackerRankId").value.trim(),
    enabled: true,
  });

  return contestUrl;
}

$("save").onclick = async () => {
  try {
    const url = await save();
    $("contestUrl").value = url;
    $("status").textContent = "Configuration saved.";
  } catch (error) {
    $("status").textContent = error.message;
  }
};

$("start").onclick = async () => {
  try {
    await save();

    chrome.runtime.sendMessage({ type: "OPEN_CONTEST" }, (response) => {
      if (chrome.runtime.lastError) {
        $("status").textContent = chrome.runtime.lastError.message;
        return;
      }

      $("status").textContent = response?.ok
        ? "Contest opened."
        : "Could not open contest.";
    });
  } catch (error) {
    $("status").textContent = error.message;
  }
};

$("reenter").onclick = async () => {
  try {
    await save();

    chrome.runtime.sendMessage({ type: "REENTER_CONTEST" }, (response) => {
      if (chrome.runtime.lastError) {
        $("status").textContent = chrome.runtime.lastError.message;
        return;
      }

      $("status").textContent = response?.ok
        ? "Re-entry recorded."
        : "Could not re-enter.";
    });
  } catch (error) {
    $("status").textContent = error.message;
  }
};
