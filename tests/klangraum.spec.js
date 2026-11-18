import { test, expect } from "@playwright/test";

function wavBuffer() {
  const samples = 44100 * 2;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF");
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(44100, 24);
  wav.writeUInt32LE(88200, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(
      Math.sin((i * 2 * Math.PI * 440) / 44100) * 5000,
      44 + i * 2,
    );
  return wav;
}

test("German interface, info dialog, responsive layouts, and no external requests at startup", async ({
  page,
}, testInfo) => {
  const errors = [];
  const external = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      !request.url().startsWith("http://localhost:43187")
    )
      external.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("lang", "de");
  await expect(page.locator("#silence, .intro, .session-tag")).toHaveCount(0);
  await expect(
    page.getByText("Made by VictoNillo", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Impressum (neuer Tab)" }),
  ).toHaveAttribute(
    "href",
    "https://victornillo.com/web-legal-information/impressum.html",
  );
  await expect(
    page.getByRole("button", { name: "Aufnahme starten" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("switch", { name: "Verstärkung" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: "Info", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Nur für diesen Moment" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  for (const [name, width, height] of [
    ["desktop", 1440, 1000],
    ["school", 1920, 1080],
    ["mobile", 390, 844],
    ["small", 320, 740],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    if (name === "desktop" || name === "mobile")
      await page.screenshot({
        path: testInfo.outputPath(`${name}.png`),
        fullPage: true,
      });
  }
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
      cookies: document.cookie,
    })),
  ).toEqual({ local: 0, session: 0, cookies: "" });
});

test("theme follows the system, toggles by keyboard without storage, and privacy opens separately", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const button = page.getByRole("button", { name: "Hellen Modus einschalten" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(
    page.getByRole("button", { name: "Dunklen Modus einschalten" }),
  ).toHaveAttribute("aria-pressed", "false");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(() => [
      localStorage.length,
      sessionStorage.length,
      document.cookie,
    ]),
  ).toEqual([0, 0, ""]);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  }
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("link", { name: "Datenschutz (neuer Tab)", exact: true })
    .click();
  const privacy = await popupPromise;
  await privacy.emulateMedia({ colorScheme: "dark" });
  await expect(
    privacy.getByRole("heading", { name: "Datenschutzerklärung", exact: true }),
  ).toBeVisible();
  await expect(
    privacy.getByRole("heading", {
      name: "YouTube erst nach deiner Entscheidung",
    }),
  ).toBeVisible();
  await expect(privacy.locator("iframe, audio, canvas")).toHaveCount(0);
  await privacy
    .getByRole("button", { name: "Hellen Modus einschalten" })
    .click();
  await expect(privacy.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("local music plays, closing pauses it, and reload discards it", async ({
  page,
}) => {
  await page.goto("/");
  await page.locator("#music-file").setInputFiles({
    name: "Testton.wav",
    mimeType: "audio/wav",
    buffer: wavBuffer(),
  });
  await expect(page.locator("#track-name")).toHaveText("Testton.wav");
  await page.locator("#music-player").evaluate((audio) => audio.play());
  await expect
    .poll(() =>
      page
        .locator("#music-player")
        .evaluate((audio) => !audio.paused && audio.currentTime > 0),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Audiodatei schließen" }).click();
  expect(
    await page.locator("#music-player").evaluate((audio) => audio.paused),
  ).toBe(true);
  await page.reload();
  await expect(page.locator("#local-player")).toBeHidden();
  expect(await page.locator("#music-player").getAttribute("src")).toBeNull();
});

test("YouTube is opt-in, validates hosts, supports common links and pauses on tab change", async ({
  page,
}) => {
  await page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Mock YouTube</title><script>window.addEventListener("message",e=>{const data=JSON.parse(e.data);if(data.event==="listening")parent.postMessage(JSON.stringify({event:"onReady"}),e.origin);else window.lastCommand=data})</script>',
    }),
  );
  await page.goto("/");
  await page.getByRole("tab", { name: "YouTube" }).click();
  expect(await page.locator("iframe").count()).toBe(0);
  const invalid = [
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://evil.test/dQw4w9WgXcQ",
  ];
  for (const value of invalid) {
    await page.locator("#youtube-url").fill(value);
    await page
      .getByRole("button", { name: "Video laden", exact: true })
      .click();
    expect(await page.locator("iframe").count()).toBe(0);
    await expect(page.locator("#notice")).toContainText("gültigen");
  }
  for (const value of [
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ?t=12",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ",
    "https://www.youtube.com/live/dQw4w9WgXcQ",
  ]) {
    await page.locator("#youtube-url").fill(value);
    await page
      .getByRole("button", { name: "Video laden", exact: true })
      .click();
    await expect(page.locator("iframe")).toHaveAttribute(
      "src",
      /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/,
    );
  }
  await expect.poll(() => page.frames().length).toBe(2);
  await page.getByRole("tab", { name: "Audiodatei" }).click();
  await expect
    .poll(() => page.frames()[1].evaluate(() => window.lastCommand?.func))
    .toBe("pauseVideo");
  await page.getByRole("tab", { name: "YouTube" }).click();
  await page.getByRole("button", { name: "Video schließen" }).click();
  expect(await page.locator("iframe").count()).toBe(0);
});

test("microphone denial gives a useful error and leaves controls safe", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => {
        throw new DOMException("Denied", "NotAllowedError");
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Mikrofon aktivieren" }).click();
  await expect(page.locator("#notice")).toContainText(
    "Mikrofonzugriff nicht erlaubt",
  );
  await expect(
    page.getByRole("button", { name: "Aufnahme starten" }),
  ).toBeDisabled();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Mikrofon aktivieren" }),
  ).toBeEnabled();
});

test("microphone records an audible clip, plays, downloads, deletes, and clears on refresh", async ({
  page,
  browserName,
}) => {
  if (browserName === "webkit")
    await page.addInitScript(() => {
      navigator.mediaDevices.getUserMedia = async () => {
        const context = new AudioContext();
        const oscillator = context.createOscillator();
        const destination = context.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        await context.resume();
        window.testMicContext = context;
        return destination.stream;
      };
    });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  test.skip(
    !(await page.evaluate(() => Boolean(window.MediaRecorder))),
    "This Linux WebKit build has no MediaRecorder; the UI correctly disables recording.",
  );
  await page.getByRole("button", { name: "Mikrofon aktivieren" }).click();
  await expect(page.locator("#mic-status")).toHaveText("1 aktiv");
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await page.getByRole("switch").click();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.getByRole("button", { name: "Aufnahme starten" }).click();
  await expect(
    page.getByRole("button", { name: "Aufnahme beenden" }),
  ).toBeEnabled();
  await expect(page.locator(".mic-select")).toBeDisabled();
  await page.waitForTimeout(1700);
  await page.getByRole("switch", { name: "Verstärkung" }).click();
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
  await expect(
    page.getByRole("button", { name: "Aufnahme beenden" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Aufnahme beenden" }).click();
  await expect(page.locator(".clip")).toHaveCount(1);
  const decoded = await page.locator(".clip audio").evaluate(async (audio) => {
    const buffer = await (await fetch(audio.src)).arrayBuffer();
    const bytes = buffer.byteLength;
    const context = new AudioContext();
    const data = await context.decodeAudioData(buffer);
    const peak = data
      .getChannelData(0)
      .reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    await context.close();
    return { duration: data.duration, peak, bytes };
  });
  expect(decoded.duration).toBeGreaterThan(1);
  expect(decoded.peak).toBeGreaterThan(0.001);
  expect(decoded.bytes).toBeGreaterThan(1000);
  await page.locator(".clip audio").evaluate((audio) => audio.play());
  await expect
    .poll(() => page.locator(".clip audio").evaluate((audio) => !audio.paused))
    .toBe(true);
  await page.locator(".clip-name").fill("Unser Lied");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Aufnahme 1 herunterladen" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^Unser Lied\.(webm|ogg|m4a)$/);
  await page.getByRole("button", { name: "Aufnahme 1 löschen" }).click();
  await expect(page.locator(".clip")).toHaveCount(0);
  await page.getByRole("button", { name: "Aufnahme starten" }).click();
  await page.waitForTimeout(1100);
  await page.getByRole("button", { name: "Aufnahme beenden" }).click();
  await expect(page.locator(".clip")).toHaveCount(1);
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.locator(".clip")).toHaveCount(0);
  await expect(page.locator("#mic-status")).toHaveText("Aus");
  expect(errors).toEqual([]);
});

test("recording excludes local music when the microphone is silent", async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const silent = context.createGain();
      silent.gain.value = 0;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(silent);
      silent.connect(destination);
      oscillator.start();
      await context.resume();
      window.testMicContext = context;
      return destination.stream;
    };
  });
  await page.goto("/");
  test.skip(
    !(await page.evaluate(() => Boolean(window.MediaRecorder))),
    "This Linux WebKit build has no MediaRecorder.",
  );
  await page.getByRole("button", { name: "Mikrofon aktivieren" }).click();
  await expect(page.locator("#mic-status")).toHaveText("1 aktiv");
  await page.locator("#music-file").setInputFiles({
    name: "Testton.wav",
    mimeType: "audio/wav",
    buffer: wavBuffer(),
  });
  await page.locator("#music-player").evaluate((audio) => {
    audio.loop = true;
    return audio.play();
  });
  await page.getByRole("button", { name: "Aufnahme starten" }).click();
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Aufnahme beenden" }).click();
  await expect(page.locator(".clip")).toHaveCount(1);
  const peak = await page.locator(".clip audio").evaluate(async (audio) => {
    const context = new AudioContext();
    const data = await context.decodeAudioData(
      await (await fetch(audio.src)).arrayBuffer(),
    );
    const peak = data
      .getChannelData(0)
      .reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    await context.close();
    return peak;
  });
  expect(peak).toBeLessThan(0.0001);
});

test("multiple microphones, duplicate prevention, and disconnect during recording", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const devices = [
      {
        kind: "audioinput",
        deviceId: "mic-one",
        label: "Mikrofon eins",
        groupId: "one",
      },
      {
        kind: "audioinput",
        deviceId: "mic-two",
        label: "Mikrofon zwei",
        groupId: "two",
      },
    ];
    navigator.mediaDevices.enumerateDevices = async () => devices;
    window.testStreams = new Map();
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const id = constraints.audio.deviceId?.exact || "mic-one";
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      oscillator.frequency.value = id === "mic-one" ? 440 : 660;
      const destination = context.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await context.resume();
      const track = destination.stream.getAudioTracks()[0];
      track.getSettings = () => ({ deviceId: id });
      // Firefox ignores untrusted MediaStreamTrack "ended" events. Expose a
      // deterministic hardware-disconnect hook on this synthetic microphone.
      const ended = [];
      const nativeAdd = track.addEventListener.bind(track);
      track.addEventListener = (type, listener, options) => {
        if (type === "ended") ended.push(listener);
        nativeAdd(type, listener, options);
      };
      window.testStreams.set(id, {
        track,
        context,
        end: () => {
          track.stop();
          ended.forEach((listener) => listener());
        },
      });
      return destination.stream;
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Mikrofon aktivieren" }).click();
  await expect(page.locator("#mic-status")).toHaveText("1 aktiv");
  await page.getByRole("button", { name: "Weiteres Mikrofon" }).click();
  await page.getByRole("button", { name: "Mikrofon aktivieren" }).click();
  await expect(page.locator("#mic-status")).toHaveText("2 aktiv");
  await page.locator(".mic-select").nth(1).selectOption("mic-one");
  await expect(page.locator("#notice")).toContainText("schon aktiv");
  await expect(page.locator("#mic-status")).toHaveText("2 aktiv");
  await expect(page.locator(".mic-select").nth(1)).toHaveValue("mic-two");
  const canRecord = await page.evaluate(() => Boolean(window.MediaRecorder));
  if (canRecord) {
    await page.getByRole("button", { name: "Aufnahme starten" }).click();
    await page.waitForTimeout(1100);
  } else
    await expect(
      page.getByRole("button", { name: "Aufnahme starten" }),
    ).toBeDisabled();
  await page.evaluate(() => window.testStreams.get("mic-two").end());
  if (canRecord) await expect(page.locator(".clip")).toHaveCount(1);
  await expect(page.locator("#mic-status")).toHaveText("1 aktiv");
  if (canRecord)
    await expect(
      page.getByRole("button", { name: "Aufnahme starten" }),
    ).toBeEnabled();
  await page
    .getByRole("button", { name: "Mikrofon entfernen" })
    .first()
    .click();
  await expect(page.locator("#mic-status")).toHaveText("Aus");
  await expect(page.getByRole("switch")).toHaveAttribute(
    "aria-checked",
    "false",
  );
});
