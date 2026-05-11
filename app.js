const audio = document.getElementById("audio");
const fileInput = document.getElementById("file-input");
const filePickerButton = document.getElementById("file-picker-button");
const reopenFileButton = document.getElementById("reopen-file");
const fileName = document.getElementById("file-name");
const fileHint = document.getElementById("file-hint");
const fileAccessStatus = document.getElementById("file-access-status");
const trackTitle = document.getElementById("track-title");
const trackMeta = document.getElementById("track-meta");
const progress = document.getElementById("progress");
const currentTimeLabel = document.getElementById("current-time");
const durationLabel = document.getElementById("duration");
const playToggle = document.getElementById("play-toggle");
const back15 = document.getElementById("back-15");
const forward30 = document.getElementById("forward-30");
const playbackRate = document.getElementById("playback-rate");
const volume = document.getElementById("volume");
const sleepTimer = document.getElementById("sleep-timer");
const sleepStatus = document.getElementById("sleep-status");
const cancelTimer = document.getElementById("cancel-timer");
const resumeBanner = document.getElementById("resume-banner");
const resumeText = document.getElementById("resume-text");
const resumeButton = document.getElementById("resume-button");
const loginModal = document.getElementById("login-modal");
const loginForm = document.getElementById("login-form");
const usernameInput = document.getElementById("username");
const loginMessage = document.getElementById("login-message");
const activeUser = document.getElementById("active-user");
const switchUser = document.getElementById("switch-user");
const themeToggle = document.getElementById("theme-toggle");
const themeIcon = document.getElementById("theme-icon");
const themeLabel = document.getElementById("theme-label");
const themeColorMeta = document.querySelector('meta[name="theme-color"]');

let currentUser = null;
let currentFileId = null;
let currentFileName = null;
let currentObjectUrl = null;
let pendingResume = null;
let saveThrottle = 0;
let sleepCountdown = null;
let sleepRemaining = 0;
let fileAccessRefreshToken = 0;
let isReopeningLastFile = false;

const STORAGE_KEY = "audiobookProfiles";
const LAST_USER_KEY = "audiobookLastUser";
const THEME_KEY = "audiobookTheme";
const FILE_HANDLES_DB = "audiobookFileHandles";
const FILE_HANDLES_STORE = "handles";
const FILE_HANDLES_VERSION = 1;
const AUDIO_FILE_TYPES = [
  {
    description: "Audio files",
    accept: {
      "audio/*": [".mp3", ".m4a", ".m4b", ".wav", ".ogg", ".aac"],
    },
  },
];

const isRecord = (value) =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (!Number.isFinite(max)) {
    return Math.max(min, value);
  }
  return Math.min(Math.max(value, min), max);
};

const normalizeProgressEntry = (entry) => {
  if (!isRecord(entry)) {
    return null;
  }
  return {
    position: Math.max(0, Number(entry.position) || 0),
    duration: Math.max(0, Number(entry.duration) || 0),
    updatedAt:
      typeof entry.updatedAt === "string"
        ? entry.updatedAt
        : new Date().toISOString(),
  };
};

const normalizeProfile = (profile) => {
  const source = isRecord(profile) ? profile : {};
  const progressMap = isRecord(source.progress) ? source.progress : {};
  const progressEntries = Object.entries(progressMap)
    .map(([key, entry]) => [key, normalizeProgressEntry(entry)])
    .filter(([, entry]) => entry);

  return {
    progress: Object.fromEntries(progressEntries),
    lastFileId:
      typeof source.lastFileId === "string" ? source.lastFileId : null,
    lastFileName:
      typeof source.lastFileName === "string" ? source.lastFileName : null,
    playbackRate:
      typeof source.playbackRate === "string" ||
      typeof source.playbackRate === "number"
        ? String(source.playbackRate)
        : "1",
    volume:
      typeof source.volume === "string" || typeof source.volume === "number"
        ? String(source.volume)
        : "1",
  };
};

const normalizeProfiles = (profiles) => {
  if (!isRecord(profiles)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(profiles)
      .filter(([username]) => username.trim())
      .map(([username, profile]) => [username, normalizeProfile(profile)])
  );
};

const loadProfiles = () => {
  const emptyProfiles = {};

  try {
    const rawProfiles = localStorage.getItem(STORAGE_KEY);
    if (!rawProfiles) {
      return emptyProfiles;
    }

    const parsedProfiles = JSON.parse(rawProfiles);
    const normalizedProfiles = normalizeProfiles(parsedProfiles);
    if (JSON.stringify(parsedProfiles) !== JSON.stringify(normalizedProfiles)) {
      saveProfiles(normalizedProfiles);
    }
    return normalizedProfiles;
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyProfiles));
    } catch {
      // Ignore storage write failures so the player can still run.
    }
    return emptyProfiles;
  }
};

const saveProfiles = (profiles) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeProfiles(profiles)));
  } catch {
    // Storage can fail in private browsing or quota-limited contexts.
  }
};

const formatTime = (value) => {
  if (!Number.isFinite(value)) {
    return "0:00";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getFileId = (file) =>
  `${file.name}:${file.size}:${file.lastModified || 0}`;

const getSafeDuration = () =>
  Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;

const updateProgressUI = () => {
  const duration = getSafeDuration();
  progress.value = duration ? (audio.currentTime / duration) * 100 : 0;
  currentTimeLabel.textContent = formatTime(audio.currentTime);
  durationLabel.textContent = formatTime(duration);
};

const updatePlayButton = () => {
  playToggle.innerHTML = audio.paused
    ? '<span aria-hidden="true">&#9654;</span><span>Play</span>'
    : '<span aria-hidden="true">&#10073;&#10073;</span><span>Pause</span>';
};

const getSystemTheme = () => {
  const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
  return systemThemeQuery?.matches ? "dark" : "light";
};

const getStoredTheme = () => {
  try {
    const storedTheme = localStorage.getItem(THEME_KEY);
    return storedTheme === "dark" || storedTheme === "light" ? storedTheme : null;
  } catch {
    return null;
  }
};

const applyTheme = (theme) => {
  const nextTheme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = nextTheme;
  themeToggle.setAttribute("aria-pressed", String(nextTheme === "dark"));
  themeIcon.innerHTML = nextTheme === "dark" ? "&#9728;" : "&#9790;";
  themeLabel.textContent = nextTheme === "dark" ? "Light mode" : "Dark mode";
  if (themeColorMeta) {
    themeColorMeta.setAttribute(
      "content",
      nextTheme === "dark" ? "#111214" : "#f5f7fb"
    );
  }
};

const setPreferredTheme = (theme) => {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme changes are cosmetic, so ignore storage failures.
  }
};

const openFileHandleDb = () =>
  new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("IndexedDB is unavailable."));
      return;
    }

    const request = indexedDB.open(FILE_HANDLES_DB, FILE_HANDLES_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_HANDLES_STORE)) {
        db.createObjectStore(FILE_HANDLES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const runHandleTransaction = async (mode, callback) => {
  const db = await openFileHandleDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(FILE_HANDLES_STORE, mode);
    const store = transaction.objectStore(FILE_HANDLES_STORE);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
};

const saveFileHandle = async (fileId, handle) => {
  if (!fileId || !handle) {
    return;
  }
  await runHandleTransaction("readwrite", (store) => store.put(handle, fileId));
};

const getFileHandle = async (fileId) => {
  if (!fileId) {
    return null;
  }
  try {
    return await runHandleTransaction("readonly", (store) => store.get(fileId));
  } catch {
    return null;
  }
};

const deleteFileHandle = async (fileId) => {
  if (!fileId) {
    return;
  }
  try {
    await runHandleTransaction("readwrite", (store) => store.delete(fileId));
  } catch {
    // Stale handle cleanup is best-effort.
  }
};

const canUseFileSystemAccess = () =>
  "showOpenFilePicker" in window && "indexedDB" in window;

const isUsableFileHandle = (handle) =>
  Boolean(handle) && typeof handle.getFile === "function";

const requestFileHandlePermission = async (handle) => {
  if (!isUsableFileHandle(handle)) {
    return "denied";
  }

  if (typeof handle.queryPermission !== "function") {
    return "granted";
  }

  try {
    const options = { mode: "read" };
    let permission = await handle.queryPermission(options);
    if (
      permission === "prompt" &&
      typeof handle.requestPermission === "function"
    ) {
      permission = await handle.requestPermission(options);
    }
    return permission;
  } catch {
    return "denied";
  }
};

const setFileAccessStatus = (message) => {
  fileAccessStatus.textContent = message || "";
};

const applyFileAccessRefresh = (refreshToken, refreshUser, callback) => {
  if (refreshToken !== fileAccessRefreshToken || refreshUser !== currentUser) {
    return false;
  }
  callback();
  return true;
};

const hideReopenFileButton = (message) => {
  reopenFileButton.textContent = "Reopen last file";
  reopenFileButton.classList.add("hidden");
  reopenFileButton.disabled = true;
  setFileAccessStatus(message);
};

const refreshFileAccessUI = async () => {
  const refreshToken = (fileAccessRefreshToken += 1);
  const refreshUser = currentUser;
  const profile = getCurrentProfile();

  if (!canUseFileSystemAccess()) {
    applyFileAccessRefresh(refreshToken, refreshUser, () => {
      filePickerButton.textContent = "Choose audio";
      hideReopenFileButton(
        "Your browser will ask you to choose the file each session."
      );
    });
    return;
  }

  filePickerButton.textContent = "Choose audio";
  if (!profile?.lastFileId || !profile?.lastFileName) {
    applyFileAccessRefresh(refreshToken, refreshUser, () => {
      hideReopenFileButton(
        "This browser can reopen approved files after you choose them."
      );
    });
    return;
  }

  const handle = await getFileHandle(profile.lastFileId);
  if (!isUsableFileHandle(handle)) {
    if (handle) {
      await deleteFileHandle(profile.lastFileId);
    }
    applyFileAccessRefresh(refreshToken, refreshUser, () => {
      hideReopenFileButton("Choose a file once to enable quick reopen here.");
    });
    return;
  }

  applyFileAccessRefresh(refreshToken, refreshUser, () => {
    reopenFileButton.textContent = isReopeningLastFile
      ? `Opening ${profile.lastFileName}...`
      : `Reopen ${profile.lastFileName}`;
    reopenFileButton.classList.remove("hidden");
    reopenFileButton.disabled = isReopeningLastFile;
    setFileAccessStatus(
      isReopeningLastFile
        ? `Opening ${profile.lastFileName}...`
        : "You can reopen the last approved file on this browser."
    );
  });
};

const setUser = (username) => {
  currentUser = username;
  activeUser.textContent = `Signed in as ${username}`;
  try {
    localStorage.setItem(LAST_USER_KEY, username);
  } catch {
    // Ignore storage write failures.
  }
};

const showLogin = () => {
  loginModal.classList.remove("hidden");
  loginModal.style.display = "flex";
  document.body.classList.add("modal-open");
  loginMessage.textContent = "";
  usernameInput.focus();
};

const hideLogin = () => {
  loginModal.classList.add("hidden");
  loginModal.style.display = "none";
  document.body.classList.remove("modal-open");
};

const getCurrentProfile = () => {
  if (!currentUser) {
    return null;
  }
  const profiles = loadProfiles();
  return profiles[currentUser] || null;
};

const saveCurrentProfile = (updates) => {
  if (!currentUser) {
    return;
  }

  const profiles = loadProfiles();
  const profile = profiles[currentUser] || normalizeProfile({});
  profiles[currentUser] = normalizeProfile({ ...profile, ...updates });
  saveProfiles(profiles);
};

const ensureResumeHint = () => {
  const profile = getCurrentProfile();
  if (!profile) {
    hideResumePrompt();
    fileHint.textContent = "";
    return;
  }

  if (profile.lastFileName) {
    fileHint.textContent = `Last file: ${profile.lastFileName}`;
  } else {
    fileHint.textContent = "";
  }
};

const showResumePrompt = (savedPosition, duration) => {
  resumeText.textContent = `Saved position at ${formatTime(
    savedPosition
  )} of ${formatTime(duration)}.`;
  resumeButton.disabled = false;
  resumeBanner.classList.remove("hidden");
};

const hideResumePrompt = () => {
  pendingResume = null;
  resumeButton.disabled = true;
  resumeBanner.classList.add("hidden");
};

const applyProfileSettings = (profile) => {
  if (!profile) {
    return;
  }

  if (profile.playbackRate) {
    playbackRate.value = profile.playbackRate;
    audio.playbackRate = Number(profile.playbackRate);
  }
  if (profile.volume != null) {
    volume.value = profile.volume;
    audio.volume = Number(profile.volume);
  }
};

const findSavedProgress = (profile, fileId, legacyFileName) => {
  if (!profile?.progress) {
    return null;
  }
  return profile.progress[fileId] || profile.progress[legacyFileName] || null;
};

const updateProfileProgress = () => {
  if (!currentUser || !currentFileId) {
    return;
  }

  const profile = getCurrentProfile();
  if (!profile) {
    return;
  }

  const progressMap = { ...(profile.progress || {}) };
  progressMap[currentFileId] = {
    position: Math.max(0, audio.currentTime || 0),
    duration: getSafeDuration(),
    updatedAt: new Date().toISOString(),
  };
  saveCurrentProfile({
    progress: progressMap,
    lastFileId: currentFileId,
    lastFileName: currentFileName,
  });
};

const setSleepTimer = (seconds) => {
  if (sleepCountdown) {
    clearInterval(sleepCountdown);
    sleepCountdown = null;
  }
  sleepRemaining = seconds;
  if (!seconds) {
    sleepStatus.textContent = "Sleep timer off.";
    cancelTimer.disabled = true;
    return;
  }

  cancelTimer.disabled = false;
  sleepStatus.textContent = `Sleeping in ${formatTime(sleepRemaining)}.`;
  sleepCountdown = setInterval(() => {
    sleepRemaining -= 1;
    if (sleepRemaining <= 0) {
      clearInterval(sleepCountdown);
      sleepCountdown = null;
      sleepRemaining = 0;
      audio.pause();
      updatePlayButton();
      sleepStatus.textContent = "Sleep timer finished. Playback paused.";
      cancelTimer.disabled = true;
      sleepTimer.value = "off";
      return;
    }
    sleepStatus.textContent = `Sleeping in ${formatTime(sleepRemaining)}.`;
  }, 1000);
};

const revokeCurrentObjectUrl = () => {
  if (currentObjectUrl) {
    URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
};

const resetPlayerState = ({ keepFileHint = false } = {}) => {
  audio.pause();
  revokeCurrentObjectUrl();
  audio.removeAttribute("src");
  audio.load();

  currentFileId = null;
  currentFileName = null;
  saveThrottle = 0;
  pendingResume = null;
  fileInput.value = "";

  fileName.textContent = "No file selected";
  if (!keepFileHint) {
    fileHint.textContent = "";
  }
  trackTitle.textContent = "No audio loaded";
  trackMeta.textContent = currentUser
    ? "Select a file to begin."
    : "Sign in and select a file to begin.";
  progress.value = 0;
  currentTimeLabel.textContent = "0:00";
  durationLabel.textContent = "0:00";
  hideResumePrompt();
  updatePlayButton();
};

const prepareResumePrompt = () => {
  if (!pendingResume) {
    hideResumePrompt();
    return;
  }

  const duration = getSafeDuration() || pendingResume.duration || 0;
  const position = clamp(pendingResume.position, 0, duration);
  pendingResume = { ...pendingResume, position, duration };

  if (position > 0) {
    showResumePrompt(position, duration);
  } else {
    hideResumePrompt();
  }
};

const loadAudioFile = async (file, handle = null) => {
  if (!file) {
    return;
  }

  updateProfileProgress();
  revokeCurrentObjectUrl();
  hideResumePrompt();

  currentFileId = getFileId(file);
  currentFileName = file.name;
  saveThrottle = 0;

  const profile = getCurrentProfile();
  const saved = findSavedProgress(profile, currentFileId, currentFileName);
  if (saved) {
    pendingResume = {
      fileId: currentFileId,
      position: saved.position,
      duration: saved.duration,
    };
  }

  currentObjectUrl = URL.createObjectURL(file);
  audio.src = currentObjectUrl;
  audio.load();

  fileName.textContent = file.name;
  trackTitle.textContent = file.name;
  trackMeta.textContent = `Loaded locally - ${formatFileSize(file.size)}`;
  fileHint.textContent = "";

  saveCurrentProfile({
    lastFileId: currentFileId,
    lastFileName: currentFileName,
  });

  if (handle) {
    try {
      await saveFileHandle(currentFileId, handle);
    } catch {
      setFileAccessStatus("File loaded, but quick reopen could not be saved.");
    }
  }

  if (getSafeDuration()) {
    prepareResumePrompt();
  }

  await refreshFileAccessUI();
};

const openWithFileSystemPicker = async () => {
  if (!canUseFileSystemAccess()) {
    fileInput.click();
    return;
  }

  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      types: AUDIO_FILE_TYPES,
    });
    if (!handle) {
      return;
    }

    if (!isUsableFileHandle(handle)) {
      throw new Error("The selected file handle is unavailable.");
    }

    const file = await handle.getFile();
    await loadAudioFile(file, handle);
  } catch (error) {
    if (error.name !== "AbortError") {
      setFileAccessStatus("Unable to open that file. Try browsing instead.");
    }
  }
};

const reopenLastFile = async () => {
  if (isReopeningLastFile) {
    return;
  }

  const profile = getCurrentProfile();
  if (!profile?.lastFileId) {
    await refreshFileAccessUI();
    return;
  }

  const reopenUser = currentUser;
  let finalStatus = "";

  isReopeningLastFile = true;
  reopenFileButton.disabled = true;
  reopenFileButton.textContent = profile.lastFileName
    ? `Opening ${profile.lastFileName}...`
    : "Opening last file...";
  setFileAccessStatus(reopenFileButton.textContent);

  try {
    const handle = await getFileHandle(profile.lastFileId);
    if (!isUsableFileHandle(handle)) {
      if (handle) {
        await deleteFileHandle(profile.lastFileId);
      }
      finalStatus = "Choose the file again to restore quick reopen.";
      return;
    }

    const permission = await requestFileHandlePermission(handle);
    if (permission !== "granted") {
      finalStatus = "Permission is needed before reopening that file.";
      return;
    }

    const file = await handle.getFile();
    await loadAudioFile(file, handle);
    finalStatus = `Reopened ${file.name}.`;
  } catch (error) {
    await deleteFileHandle(profile.lastFileId);
    finalStatus =
      error?.name === "NotFoundError"
        ? "That file moved or was deleted. Choose it again."
        : "That file could not be reopened. Choose it again.";
  } finally {
    isReopeningLastFile = false;
    if (currentUser === reopenUser) {
      await refreshFileAccessUI();
      if (finalStatus) {
        setFileAccessStatus(finalStatus);
      }
    }
  }
};

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  if (!username) {
    loginMessage.textContent = "Please enter a username.";
    return;
  }

  const profiles = loadProfiles();
  if (!profiles[username]) {
    profiles[username] = normalizeProfile({});
    saveProfiles(profiles);
  }

  setUser(username);
  applyProfileSettings(getCurrentProfile());
  ensureResumeHint();
  await refreshFileAccessUI();
  hideLogin();
});

switchUser.addEventListener("click", () => {
  updateProfileProgress();
  resetPlayerState();
  setSleepTimer(0);
  sleepTimer.value = "off";
  currentUser = null;
  activeUser.textContent = "Not signed in";
  try {
    localStorage.removeItem(LAST_USER_KEY);
  } catch {
    // Ignore storage write failures.
  }
  usernameInput.value = "";
  setFileAccessStatus("");
  showLogin();
});

themeToggle.addEventListener("click", () => {
  const currentTheme = document.documentElement.dataset.theme;
  setPreferredTheme(currentTheme === "dark" ? "light" : "dark");
});

const themePreferenceQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
themePreferenceQuery?.addEventListener?.("change", (event) => {
  if (!getStoredTheme()) {
    applyTheme(event.matches ? "dark" : "light");
  }
});

filePickerButton.addEventListener("click", openWithFileSystemPicker);

reopenFileButton.addEventListener("click", reopenLastFile);

fileInput.addEventListener("change", async (event) => {
  const file = event.target.files[0];
  await loadAudioFile(file);
});

resumeButton.addEventListener("click", () => {
  if (pendingResume) {
    const duration = getSafeDuration() || pendingResume.duration || 0;
    audio.currentTime = clamp(pendingResume.position, 0, duration);
    updateProgressUI();
  }
  hideResumePrompt();
});

playToggle.addEventListener("click", async () => {
  if (!audio.src) {
    return;
  }

  if (audio.paused) {
    try {
      await audio.play();
    } catch {
      trackMeta.textContent = "Playback could not start for this file.";
    }
  } else {
    audio.pause();
  }
});

back15.addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 15);
  updateProgressUI();
});

forward30.addEventListener("click", () => {
  audio.currentTime = Math.min(getSafeDuration(), audio.currentTime + 30);
  updateProgressUI();
});

playbackRate.addEventListener("change", () => {
  audio.playbackRate = Number(playbackRate.value);
  saveCurrentProfile({ playbackRate: playbackRate.value });
});

volume.addEventListener("input", () => {
  audio.volume = Number(volume.value);
  saveCurrentProfile({ volume: volume.value });
});

sleepTimer.addEventListener("change", () => {
  const value = sleepTimer.value;
  setSleepTimer(value === "off" ? 0 : Number(value));
});

cancelTimer.addEventListener("click", () => {
  setSleepTimer(0);
  sleepTimer.value = "off";
});

progress.addEventListener("input", () => {
  const duration = getSafeDuration();
  if (!duration) {
    return;
  }
  audio.currentTime = (Number(progress.value) / 100) * duration;
  updateProgressUI();
});

audio.addEventListener("loadedmetadata", () => {
  updateProgressUI();
  prepareResumePrompt();
});

audio.addEventListener("timeupdate", () => {
  updateProgressUI();
  saveThrottle += 1;
  if (saveThrottle % 10 === 0) {
    updateProfileProgress();
  }
});

audio.addEventListener("play", updatePlayButton);

audio.addEventListener("pause", () => {
  updatePlayButton();
  updateProfileProgress();
});

audio.addEventListener("ended", () => {
  updatePlayButton();
  updateProfileProgress();
});

window.addEventListener("beforeunload", () => {
  updateProfileProgress();
  revokeCurrentObjectUrl();
});

const registerServiceWorker = async () => {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("./sw.js");
  } catch {
    // The app still works without service worker support.
  }
};

const init = async () => {
  applyTheme(getStoredTheme() || getSystemTheme());
  resetPlayerState();
  loadProfiles();

  let lastUser = null;
  try {
    lastUser = localStorage.getItem(LAST_USER_KEY);
  } catch {
    lastUser = null;
  }

  if (lastUser) {
    const profiles = loadProfiles();
    if (profiles[lastUser]) {
      setUser(lastUser);
      applyProfileSettings(profiles[lastUser]);
      ensureResumeHint();
      await refreshFileAccessUI();
      hideLogin();
      registerServiceWorker();
      return;
    }
  }

  await refreshFileAccessUI();
  showLogin();
  registerServiceWorker();
};

init();
