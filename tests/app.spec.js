const fs = require("fs");
const path = require("path");
const { test, expect } = require("@playwright/test");

const STORAGE_KEY = "audiobookProfiles";
const LAST_USER_KEY = "audiobookLastUser";

const createWavBuffer = ({ seconds = 2, sampleRate = 8000 } = {}) => {
  const sampleCount = Math.max(1, Math.floor(seconds * sampleRate));
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28);
  buffer.writeUInt16LE(bytesPerSample, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  return buffer;
};

const writeAudioFixture = (testInfo, folder, name, options = {}) => {
  const filePath = testInfo.outputPath(folder, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const buffer = createWavBuffer(options);
  fs.writeFileSync(filePath, buffer);
  const mtime = new Date("2024-01-01T00:00:00.000Z");
  fs.utimesSync(filePath, mtime, mtime);
  return { path: filePath, name, size: buffer.length, lastModified: mtime.getTime() };
};

const profileSnapshot = async (page) =>
  page.evaluate((storageKey) => {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) : {};
  }, STORAGE_KEY);

const signIn = async (page, username = "Alex") => {
  await page.getByLabel("Username").fill(username);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.locator("#login-modal")).toHaveClass(/hidden/);
  await expect(page.locator("#active-user")).toHaveText(`Signed in as ${username}`);
};

const openApp = async (page) => {
  await page.goto("/");
  await expect(page).toHaveTitle("AudioBook Player");
  await expect(page.locator("h1")).toHaveText("AudioBook Player");
};

const uploadFixture = async (page, fixture) => {
  await page.setInputFiles("#file-input", fixture.path);
  await expect(page.locator("#track-title")).toHaveText(fixture.name);
  await expect(page.locator("#duration")).not.toHaveText("0:00", {
    timeout: 7000,
  });
};

const saveCurrentPosition = async (page, position) => {
  await page.evaluate((nextPosition) => {
    const player = document.getElementById("audio");
    player.currentTime = nextPosition;
    player.dispatchEvent(new Event("timeupdate"));
    player.dispatchEvent(new Event("pause"));
  }, position);
};

const getLastFileId = async (page, username) => {
  const profiles = await profileSnapshot(page);
  return profiles[username].lastFileId;
};

const installFileSystemAccessMock = async (page, fixtures, options = {}) => {
  const files = fixtures.map((fixture, index) => ({
    id: fixture.id || fixture.name || `file-${index}`,
    name: fixture.name,
    type: "audio/wav",
    lastModified: fixture.lastModified,
    base64: fs.readFileSync(fixture.path).toString("base64"),
  }));

  await page.addInitScript(
    ({ files: fileDefinitions, options: mockOptions }) => {
      const fileMap = new Map(fileDefinitions.map((file) => [file.id, file]));
      const defaultFileId = mockOptions.defaultFileId || fileDefinitions[0]?.id;
      const storePrefix = "__mockIndexedDb";
      const failedReadKey = "__mockFileHandleFailedRead";
      const permissionKey = "__mockFileHandlePermission";
      const nextFileKey = "__mockFilePickerNextFile";

      const readJson = (key) => {
        try {
          return JSON.parse(localStorage.getItem(key) || "{}");
        } catch {
          return {};
        }
      };

      const writeJson = (key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
      };

      const toBytes = (base64) => {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
      };

      const makeFile = (fileId) => {
        const definition = fileMap.get(fileId);
        if (!definition) {
          throw new DOMException("Mock file is unavailable.", "NotFoundError");
        }
        return new File([toBytes(definition.base64)], definition.name, {
          type: definition.type,
          lastModified: definition.lastModified,
        });
      };

      const currentPermission = () =>
        localStorage.getItem(permissionKey) || mockOptions.permission || "granted";

      const makeHandle = (fileId) => {
        const definition = fileMap.get(fileId);
        return {
          kind: "file",
          name: definition?.name || fileId,
          __mockFileHandleId: fileId,
          async queryPermission() {
            return currentPermission();
          },
          async requestPermission() {
            return currentPermission();
          },
          async getFile() {
            const failureName = localStorage.getItem(failedReadKey);
            if (failureName) {
              throw new DOMException("Mock file read failed.", failureName);
            }
            return makeFile(fileId);
          },
        };
      };

      const serializeValue = (value) =>
        value?.__mockFileHandleId
          ? { __mockType: "file-handle", id: value.__mockFileHandleId }
          : value;

      const deserializeValue = (value) =>
        value?.__mockType === "file-handle" ? makeHandle(value.id) : value;

      const createdStoreKey = (dbName, storeName) =>
        `${storePrefix}:created:${dbName}:${storeName}`;

      const dataStoreKey = (dbName, storeName) =>
        `${storePrefix}:data:${dbName}:${storeName}`;

      const makeRequest = (transaction, executor) => {
        const request = {};
        setTimeout(() => {
          try {
            request.result = executor();
            request.onsuccess?.({ target: request });
            transaction?.oncomplete?.({ target: transaction });
          } catch (error) {
            request.error = error;
            request.onerror?.({ target: request });
            if (transaction) {
              transaction.error = error;
              transaction.onerror?.({ target: transaction });
            }
          }
        }, 0);
        return request;
      };

      const createDatabase = (dbName) => ({
        objectStoreNames: {
          contains(storeName) {
            return localStorage.getItem(createdStoreKey(dbName, storeName)) === "1";
          },
        },
        createObjectStore(storeName) {
          localStorage.setItem(createdStoreKey(dbName, storeName), "1");
          return {};
        },
        transaction(storeName) {
          const transaction = {
            error: null,
            oncomplete: null,
            onerror: null,
            objectStore() {
              return {
                put(value, key) {
                  return makeRequest(transaction, () => {
                    const storeKey = dataStoreKey(dbName, storeName);
                    const data = readJson(storeKey);
                    data[key] = serializeValue(value);
                    writeJson(storeKey, data);
                    return key;
                  });
                },
                get(key) {
                  return makeRequest(transaction, () => {
                    const data = readJson(dataStoreKey(dbName, storeName));
                    return deserializeValue(data[key]);
                  });
                },
                delete(key) {
                  return makeRequest(transaction, () => {
                    const storeKey = dataStoreKey(dbName, storeName);
                    const data = readJson(storeKey);
                    delete data[key];
                    writeJson(storeKey, data);
                    return undefined;
                  });
                },
              };
            },
          };
          return transaction;
        },
        close() {},
      });

      Object.defineProperty(window, "indexedDB", {
        configurable: true,
        value: {
          open(dbName) {
            const request = {};
            setTimeout(() => {
              const database = createDatabase(dbName);
              request.result = database;
              if (!database.objectStoreNames.contains("handles")) {
                request.onupgradeneeded?.({ target: request });
              }
              request.onsuccess?.({ target: request });
            }, 0);
            return request;
          },
        },
      });

      Object.defineProperty(window, "showOpenFilePicker", {
        configurable: true,
        value: async () => {
          const fileId = localStorage.getItem(nextFileKey) || defaultFileId;
          return [makeHandle(fileId)];
        },
      });
    },
    { files, options }
  );
};

test("boots with empty storage and no PIN field", async ({ page }) => {
  await openApp(page);

  await expect(page.locator("#login-modal")).toBeVisible();
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.locator("#pin")).toHaveCount(0);
});

test("recovers from corrupt profile storage", async ({ page }) => {
  await page.addInitScript((storageKey) => {
    localStorage.setItem(storageKey, "{not-json");
  }, STORAGE_KEY);

  await openApp(page);

  await expect(page.locator("#login-modal")).toBeVisible();
  await expect
    .poll(() => page.evaluate((storageKey) => localStorage.getItem(storageKey), STORAGE_KEY))
    .toBe("{}");
});

test("migrates old PIN profiles without losing saved progress", async ({ page }) => {
  await page.addInitScript(
    ({ storageKey }) => {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          Alex: {
            pin: "1234",
            progress: {
              "chapter.mp3": {
                position: 42,
                duration: 120,
                updatedAt: "2024-01-01T00:00:00.000Z",
              },
            },
            lastFileName: "chapter.mp3",
          },
        })
      );
    },
    { storageKey: STORAGE_KEY }
  );

  await openApp(page);
  await signIn(page, "Alex");

  const profiles = await profileSnapshot(page);
  expect(profiles.Alex.pin).toBeUndefined();
  expect(profiles.Alex.progress["chapter.mp3"].position).toBe(42);
});

test("loads an audio file and saves a stable file identity", async ({ page }, testInfo) => {
  const fixture = writeAudioFixture(testInfo, "load", "chapter.wav", {
    seconds: 2,
  });

  await openApp(page);
  await signIn(page, "Alex");
  await uploadFixture(page, fixture);

  const fileId = await getLastFileId(page, "Alex");
  expect(fileId).toContain(`chapter.wav:${fixture.size}:`);
  await expect(page.locator("#track-meta")).toContainText("Loaded locally");
});

test("resumes progress by file identity after the file is selected again", async ({
  page,
}, testInfo) => {
  const fixture = writeAudioFixture(testInfo, "resume", "chapter.wav", {
    seconds: 4,
  });

  await openApp(page);
  await signIn(page, "Alex");
  await uploadFixture(page, fixture);
  await saveCurrentPosition(page, 1.5);

  await page.reload();
  await expect(page.locator("#active-user")).toHaveText("Signed in as Alex");
  await uploadFixture(page, fixture);

  await expect(page.locator("#resume-banner")).toBeVisible();
  await expect(page.locator("#resume-text")).toContainText("0:01");
});

test("reopens the last approved file after a page reload", async ({
  page,
}, testInfo) => {
  const fixture = writeAudioFixture(testInfo, "reopen", "chapter.wav", {
    seconds: 4,
  });

  await installFileSystemAccessMock(page, [fixture]);
  await openApp(page);
  await signIn(page, "Alex");
  await page.locator("#file-picker-button").click();
  await expect(page.locator("#track-title")).toHaveText(fixture.name);
  await expect(page.locator("#duration")).not.toHaveText("0:00", {
    timeout: 7000,
  });
  await saveCurrentPosition(page, 1.5);

  await page.reload();
  await expect(page.locator("#active-user")).toHaveText("Signed in as Alex");
  await expect(page.locator("#reopen-file")).toHaveText(`Reopen ${fixture.name}`);
  await page.locator("#reopen-file").click();

  await expect(page.locator("#track-title")).toHaveText(fixture.name);
  await expect(page.locator("#resume-banner")).toBeVisible();
  await expect(page.locator("#resume-text")).toContainText("0:01");
});

test("cleans up stale quick reopen handles when the file is unavailable", async ({
  page,
}, testInfo) => {
  const fixture = writeAudioFixture(testInfo, "stale-reopen", "chapter.wav", {
    seconds: 2,
  });

  await installFileSystemAccessMock(page, [fixture]);
  await openApp(page);
  await signIn(page, "Alex");
  await page.locator("#file-picker-button").click();
  await expect(page.locator("#track-title")).toHaveText(fixture.name);

  await page.reload();
  await expect(page.locator("#reopen-file")).toHaveText(`Reopen ${fixture.name}`);
  await page.evaluate(() => {
    localStorage.setItem("__mockFileHandleFailedRead", "NotFoundError");
  });
  await page.locator("#reopen-file").click();

  await expect(page.locator("#file-access-status")).toHaveText(
    "That file moved or was deleted. Choose it again."
  );
  await expect(page.locator("#reopen-file")).toHaveClass(/hidden/);
});

test("keeps progress separate for different files with the same name", async ({
  page,
}, testInfo) => {
  const first = writeAudioFixture(testInfo, "book-a", "chapter.wav", {
    seconds: 2,
  });
  const second = writeAudioFixture(testInfo, "book-b", "chapter.wav", {
    seconds: 5,
  });

  await openApp(page);
  await signIn(page, "Alex");

  await uploadFixture(page, first);
  await saveCurrentPosition(page, 1);
  const firstId = await getLastFileId(page, "Alex");

  await uploadFixture(page, second);
  await saveCurrentPosition(page, 2);
  const secondId = await getLastFileId(page, "Alex");

  expect(firstId).not.toBe(secondId);
  const profiles = await profileSnapshot(page);
  expect(profiles.Alex.progress[firstId].position).toBeCloseTo(1, 1);
  expect(profiles.Alex.progress[secondId].position).toBeCloseTo(2, 1);
});

test("clamps stale resume positions after metadata loads", async ({
  page,
}, testInfo) => {
  const fixture = writeAudioFixture(testInfo, "clamp", "chapter.wav", {
    seconds: 2,
  });

  await openApp(page);
  await signIn(page, "Alex");
  await uploadFixture(page, fixture);
  const fileId = await getLastFileId(page, "Alex");

  await page.evaluate(
    ({ storageKey, fileId }) => {
      const profiles = JSON.parse(localStorage.getItem(storageKey));
      profiles.Alex.progress[fileId] = {
        position: 999,
        duration: 999,
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      localStorage.setItem(storageKey, JSON.stringify(profiles));
    },
    { storageKey: STORAGE_KEY, fileId }
  );

  await page.reload();
  await page.evaluate(
    ({ storageKey, fileId }) => {
      const profiles = JSON.parse(localStorage.getItem(storageKey));
      profiles.Alex.progress[fileId] = {
        position: 999,
        duration: 999,
        updatedAt: "2024-01-01T00:00:00.000Z",
      };
      localStorage.setItem(storageKey, JSON.stringify(profiles));
    },
    { storageKey: STORAGE_KEY, fileId }
  );
  await uploadFixture(page, fixture);
  await expect(page.locator("#resume-banner")).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();

  const times = await page.evaluate(() => {
    const player = document.getElementById("audio");
    return { currentTime: player.currentTime, duration: player.duration };
  });
  expect(times.currentTime).toBeLessThanOrEqual(times.duration);
});

test("switching users clears playback state and prevents cross-profile saves", async ({
  page,
}, testInfo) => {
  const fixture = writeAudioFixture(testInfo, "switch", "chapter.wav", {
    seconds: 3,
  });

  await openApp(page);
  await signIn(page, "Alex");
  await uploadFixture(page, fixture);
  await saveCurrentPosition(page, 1);

  await page.getByRole("button", { name: "Switch user" }).click();
  await expect(page.locator("#active-user")).toHaveText("Not signed in");
  await expect(page.locator("#track-title")).toHaveText("No audio loaded");
  await expect(page.locator("#file-name")).toHaveText("No file selected");

  const state = await page.evaluate((lastUserKey) => ({
    src: document.getElementById("audio").getAttribute("src"),
    lastUser: localStorage.getItem(lastUserKey),
  }), LAST_USER_KEY);
  expect(state.src).toBeNull();
  expect(state.lastUser).toBeNull();

  await signIn(page, "Blair");
  await saveCurrentPosition(page, 2);
  const profiles = await profileSnapshot(page);
  expect(Object.keys(profiles.Blair.progress)).toHaveLength(0);
});

test("sleep timer pauses playback when the countdown finishes", async ({ page }) => {
  await openApp(page);
  await signIn(page, "Alex");

  await page.evaluate(() => {
    window.__pauseCalls = 0;
    const player = document.getElementById("audio");
    const originalPause = player.pause.bind(player);
    player.pause = () => {
      window.__pauseCalls += 1;
      originalPause();
    };

    const timer = document.getElementById("sleep-timer");
    timer.append(new Option("1 second", "1"));
    timer.value = "1";
    timer.dispatchEvent(new Event("change"));
  });

  await expect(page.locator("#sleep-status")).toContainText(
    "Sleep timer finished",
    { timeout: 3000 }
  );
  await expect.poll(() => page.evaluate(() => window.__pauseCalls)).toBeGreaterThan(0);
});

test("revokes the prior object URL when a new file is loaded", async ({
  page,
}, testInfo) => {
  const first = writeAudioFixture(testInfo, "url-a", "first.wav", {
    seconds: 2,
  });
  const second = writeAudioFixture(testInfo, "url-b", "second.wav", {
    seconds: 2,
  });

  await page.addInitScript(() => {
    window.__objectUrlAudit = { created: [], revoked: [] };
    const createObjectURL = URL.createObjectURL.bind(URL);
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value) => {
      const url = createObjectURL(value);
      window.__objectUrlAudit.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url) => {
      window.__objectUrlAudit.revoked.push(url);
      return revokeObjectURL(url);
    };
  });

  await openApp(page);
  await signIn(page, "Alex");
  await uploadFixture(page, first);
  await uploadFixture(page, second);

  const audit = await page.evaluate(() => window.__objectUrlAudit);
  expect(audit.created).toHaveLength(2);
  expect(audit.revoked).toContain(audit.created[0]);
});

test("exposes a valid PWA manifest and registers the service worker", async ({
  page,
  request,
}) => {
  await openApp(page);

  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "manifest.webmanifest"
  );

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest.display).toBe("standalone");
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

  const serviceWorkerResponse = await request.get("/sw.js");
  expect(serviceWorkerResponse.ok()).toBeTruthy();

  const scriptUrl = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return "unsupported";
    }
    const registration = await navigator.serviceWorker.ready;
    return (
      registration.active?.scriptURL ||
      registration.waiting?.scriptURL ||
      registration.installing?.scriptURL
    );
  });
  expect(scriptUrl).toContain("/sw.js");
});
