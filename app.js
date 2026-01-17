const audio = document.getElementById("audio");
const fileInput = document.getElementById("file-input");
const fileName = document.getElementById("file-name");
const fileHint = document.getElementById("file-hint");
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
const pinInput = document.getElementById("pin");
const loginMessage = document.getElementById("login-message");
const activeUser = document.getElementById("active-user");
const switchUser = document.getElementById("switch-user");

let currentUser = null;
let currentFileName = null;
let saveThrottle = 0;
let sleepCountdown = null;
let sleepRemaining = 0;

const STORAGE_KEY = "audiobookProfiles";
const LAST_USER_KEY = "audiobookLastUser";

const loadProfiles = () =>
  JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

const saveProfiles = (profiles) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));

const formatTime = (value) => {
  if (!Number.isFinite(value)) {
    return "0:00";
  }
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const updateProgressUI = () => {
  progress.value = audio.duration
    ? (audio.currentTime / audio.duration) * 100
    : 0;
  currentTimeLabel.textContent = formatTime(audio.currentTime);
  durationLabel.textContent = formatTime(audio.duration);
};

const updatePlayButton = () => {
  playToggle.textContent = audio.paused ? "▶ Play" : "⏸ Pause";
};

const setUser = (username) => {
  currentUser = username;
  activeUser.textContent = `Signed in as ${username}`;
  localStorage.setItem(LAST_USER_KEY, username);
};

const showLogin = () => {
  loginModal.classList.remove("hidden");
  loginModal.style.display = "flex";
  loginMessage.textContent = "";
};

const hideLogin = () => {
  loginModal.classList.add("hidden");
  loginModal.style.display = "none";
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
  const profile = profiles[currentUser] || {
    pin: "",
    progress: {},
  };
  profiles[currentUser] = { ...profile, ...updates };
  saveProfiles(profiles);
};

const ensureResumeBanner = () => {
  const profile = getCurrentProfile();
  if (!profile) {
    resumeBanner.classList.add("hidden");
    return;
  }
  const lastFile = profile.lastFileName;
  if (lastFile) {
    resumeText.textContent = `Last time you listened to ${lastFile}. Choose that file to resume.`;
    fileHint.textContent = `Last file: ${lastFile}`;
  } else {
    fileHint.textContent = "";
  }
};

const showResumePrompt = (savedPosition, duration) => {
  resumeText.textContent = `Saved position at ${formatTime(
    savedPosition
  )} of ${formatTime(duration)}.`;
  resumeBanner.classList.remove("hidden");
};

const hideResumePrompt = () => {
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

const updateProfileProgress = () => {
  if (!currentUser || !currentFileName) {
    return;
  }
  const profile = getCurrentProfile();
  if (!profile) {
    return;
  }
  const progressMap = profile.progress || {};
  progressMap[currentFileName] = {
    position: audio.currentTime,
    duration: audio.duration || 0,
    updatedAt: new Date().toISOString(),
  };
  saveCurrentProfile({
    progress: progressMap,
    lastFileName: currentFileName,
  });
};

const setSleepTimer = (seconds) => {
  if (sleepCountdown) {
    clearInterval(sleepCountdown);
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

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const username = usernameInput.value.trim();
  const pin = pinInput.value.trim();
  if (!username) {
    loginMessage.textContent = "Please enter a username.";
    return;
  }
  const profiles = loadProfiles();
  const existing = profiles[username];
  if (existing) {
    if (existing.pin && existing.pin !== pin) {
      loginMessage.textContent = "Incorrect PIN for this profile.";
      return;
    }
  } else {
    profiles[username] = {
      pin,
      progress: {},
    };
    saveProfiles(profiles);
  }
  setUser(username);
  applyProfileSettings(getCurrentProfile());
  ensureResumeBanner();
  hideLogin();
});

switchUser.addEventListener("click", () => {
  currentUser = null;
  activeUser.textContent = "Not signed in";
  showLogin();
});

fileInput.addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (!file) {
    return;
  }
  const objectUrl = URL.createObjectURL(file);
  audio.src = objectUrl;
  currentFileName = file.name;
  fileName.textContent = file.name;
  trackTitle.textContent = file.name;
  trackMeta.textContent = `Loaded locally · ${Math.round(file.size / 1024)} KB`;
  hideResumePrompt();

  const profile = getCurrentProfile();
  if (profile && profile.progress && profile.progress[currentFileName]) {
    const saved = profile.progress[currentFileName];
    showResumePrompt(saved.position, saved.duration);
    resumeButton.onclick = () => {
      audio.currentTime = saved.position;
      updateProgressUI();
      hideResumePrompt();
    };
  }
  saveCurrentProfile({ lastFileName: currentFileName });
});

resumeButton.addEventListener("click", () => {
  resumeBanner.classList.add("hidden");
});

playToggle.addEventListener("click", () => {
  if (!audio.src) {
    return;
  }
  if (audio.paused) {
    audio.play();
  } else {
    audio.pause();
  }
});

back15.addEventListener("click", () => {
  audio.currentTime = Math.max(0, audio.currentTime - 15);
});

forward30.addEventListener("click", () => {
  audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30);
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
  if (!audio.duration) {
    return;
  }
  audio.currentTime = (progress.value / 100) * audio.duration;
});

audio.addEventListener("loadedmetadata", () => {
  updateProgressUI();
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

const init = () => {
  const lastUser = localStorage.getItem(LAST_USER_KEY);
  if (lastUser) {
    const profiles = loadProfiles();
    if (profiles[lastUser]) {
      setUser(lastUser);
      applyProfileSettings(profiles[lastUser]);
      ensureResumeBanner();
      hideLogin();
      return;
    }
  }
  showLogin();
};

init();
