const $ = (id) => document.getElementById(id);
const state = {
  context: null,
  inputs: new Map(),
  devices: [],
  monitor: false,
  recorder: null,
  recording: false,
  starting: false,
  chunks: [],
  clips: new Map(),
  clipNumber: 0,
  musicUrl: null,
  timer: null,
  started: 0,
  bytes: 0,
};
const MAX_TIME = 15 * 60 * 1000;
const MAX_BYTES = 100 * 1024 * 1024;
let inputNumber = 0;
let noticeTimer;

function notice(message) {
  clearTimeout(noticeTimer);
  $("notice").textContent = message;
  $("notice").hidden = !message;
  if (message)
    noticeTimer = setTimeout(() => {
      $("notice").hidden = true;
    }, 14000);
}
function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}
function formatTime(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
async function ensureAudio() {
  if (!state.context) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext)
      throw new Error(
        "Dein Browser unterstützt die Tonverarbeitung nicht. Bitte verwende einen aktuellen Browser.",
      );
    state.context = new AudioContext({ latencyHint: "interactive" });
    state.voiceBus = state.context.createGain();
    state.monitorGain = state.context.createGain();
    state.monitorGain.gain.value = 0;
    state.analyser = state.context.createAnalyser();
    state.analyser.fftSize = 256;
    state.destination = state.context.createMediaStreamDestination();
    // Only microphone sources connect to voiceBus. Music/YouTube never enter this graph.
    state.voiceBus.connect(state.destination);
    state.voiceBus.connect(state.analyser);
    state.voiceBus.connect(state.monitorGain);
    state.monitorGain.connect(state.context.destination);
    state.context.addEventListener("statechange", () => {
      if (
        state.context.state === "interrupted" ||
        (state.context.state === "suspended" && state.inputs.size)
      ) {
        setMonitor(false);
        if (state.recording) stopRecording();
        notice(
          "Ton unterbrochen. Prüfe deinen Clip und aktiviere das Mikrofon erneut.",
        );
      }
    });
  }
  await state.context.resume();
}
function audioError(error) {
  const messages = {
    NotAllowedError:
      "Mikrofonzugriff nicht erlaubt. Erlaube das Mikrofon in den Website-Einstellungen deines Browsers.",
    NotFoundError:
      "Kein Mikrofon gefunden. Schließe ein Mikrofon an und versuche es erneut.",
    NotReadableError:
      "Das Mikrofon ist gerade nicht verfügbar. Schließe andere Audio-Apps oder wähle ein anderes Mikrofon.",
    OverconstrainedError:
      "Dieses Mikrofon ist nicht mehr verfügbar. Wähle ein anderes Mikrofon.",
    SecurityError:
      "Der Browser blockiert das Mikrofon. Öffne Klangraum über HTTPS in einem aktuellen Browser.",
  };
  return (
    messages[error.name] ||
    error.message ||
    "Der Ton konnte nicht gestartet werden. Bitte versuche es erneut."
  );
}
async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    state.devices = (await navigator.mediaDevices.enumerateDevices()).filter(
      (d) => d.kind === "audioinput",
    );
    document.querySelectorAll(".mic-select").forEach(fillSelect);
    updateControls();
  } catch {
    /* Devices remain usable through getUserMedia's default input. */
  }
}
function fillSelect(select) {
  const selected = select.dataset.device || select.value || "default";
  select.replaceChildren();
  const devices = state.devices.filter((d) => d.deviceId);
  if (!devices.some((d) => d.deviceId === "default"))
    select.add(new Option("Standardmikrofon", "default"));
  devices.forEach((d, index) =>
    select.add(new Option(d.label || `Mikrofon ${index + 1}`, d.deviceId)),
  );
  if ([...select.options].some((o) => o.value === selected))
    select.value = selected;
}
function activeInputs() {
  return [...state.inputs.values()];
}
function createInputRow() {
  const id = String(++inputNumber);
  const row = document.createElement("div");
  row.className = "mic-row";
  row.dataset.input = id;
  const label = document.createElement("label");
  label.className = "mic-input-label";
  label.htmlFor = `mic-${id}`;
  label.textContent = inputNumber === 1 ? "Eingang" : `Eingang ${inputNumber}`;
  const select = document.createElement("select");
  select.className = "mic-select";
  select.id = `mic-${id}`;
  fillSelect(select);
  const unused = state.devices.find(
    (d) =>
      d.deviceId &&
      d.deviceId !== "default" &&
      d.deviceId !== "communications" &&
      !activeInputs().some((i) => i.deviceId === d.deviceId),
  );
  if (state.inputs.size && unused) select.value = unused.deviceId;
  const remove = document.createElement("button");
  remove.className = "icon-button";
  remove.setAttribute("aria-label", "Mikrofon entfernen");
  remove.append(icon("close"));
  const activate = document.createElement("button");
  activate.className = "button mic-enable";
  activate.append(icon("mic"), document.createTextNode("Mikrofon aktivieren"));
  activate.addEventListener("click", () => connectInput(row));
  select.addEventListener("change", () => {
    if (state.inputs.has(id)) connectInput(row);
  });
  remove.addEventListener("click", () => {
    if (state.recording || state.starting) return;
    disconnectInput(id);
    row.remove();
    if (!$("mic-inputs").children.length) createInputRow();
    updateControls();
  });
  row.append(label, select, remove, activate);
  $("mic-inputs").append(row);
  updateControls();
  return row;
}
async function connectInput(row) {
  if (state.recording || state.starting) return;
  const select = row.querySelector("select");
  const activate = row.querySelector(".mic-enable");
  const oldDevice = state.inputs.get(row.dataset.input)?.deviceId;
  const requestedDevice = select.value;
  let stream;
  state.starting = true;
  updateControls();
  activate.textContent = "Wird verbunden …";
  try {
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error(
        "Mikrofonzugriff fehlt. Öffne die HTTPS-Adresse in einem aktuellen Browser.",
      );
    await ensureAudio();
    const constraints = {
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: false,
    };
    if (requestedDevice && requestedDevice !== "default")
      constraints.deviceId = { exact: requestedDevice };
    stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    const track = stream.getAudioTracks()[0];
    const deviceId = track.getSettings().deviceId || requestedDevice;
    if (
      activeInputs().some(
        (i) => i.id !== row.dataset.input && i.deviceId === deviceId,
      )
    ) {
      throw new Error(
        "Dieses Mikrofon ist schon aktiv. Wähle einen anderen Eingang.",
      );
    }
    const source = state.context.createMediaStreamSource(stream);
    disconnectInput(row.dataset.input);
    source.connect(state.voiceBus);
    state.inputs.set(row.dataset.input, {
      id: row.dataset.input,
      source,
      stream,
      deviceId,
    });
    select.dataset.device = deviceId;
    track.addEventListener("ended", () => {
      if (!state.inputs.has(row.dataset.input)) return;
      disconnectInput(row.dataset.input);
      if (state.recording) stopRecording();
      updateControls();
      notice(
        "Ein Mikrofon wurde getrennt. Wähle es neu aus oder verbinde ein anderes.",
      );
    });
    track.addEventListener("mute", () => {
      if (state.recording) stopRecording();
      setMonitor(false);
      notice(
        "Der Browser hat den Mikrofonton unterbrochen. Prüfe dein Mikrofon und den letzten Clip.",
      );
    });
    await refreshDevices();
    activate.hidden = true;
    notice("");
  } catch (error) {
    stream?.getTracks().forEach((t) => t.stop());
    if (oldDevice) {
      select.dataset.device = oldDevice;
      fillSelect(select);
    }
    notice(audioError(error));
  } finally {
    state.starting = false;
    activate.replaceChildren(
      icon("mic"),
      document.createTextNode("Mikrofon aktivieren"),
    );
    updateControls();
  }
}
function disconnectInput(id) {
  const input = state.inputs.get(id);
  if (!input) return;
  state.inputs.delete(id);
  input.source.disconnect();
  input.stream.getTracks().forEach((t) => t.stop());
  if (!state.inputs.size) setMonitor(false);
}
function updateControls() {
  const live = state.inputs.size > 0;
  const locked = state.recording || state.starting;
  $("mic-status").textContent = live ? `${state.inputs.size} aktiv` : "Aus";
  $("mic-status").classList.toggle("live", live);
  $("monitor").disabled = !live || state.starting;
  $("record").disabled =
    (!live || state.starting || !window.MediaRecorder) && !state.recording;
  $("add-mic").disabled = !live || locked;
  $("record-hint").textContent = state.recording
    ? "Deine Stimme wird aufgenommen"
    : live
      ? "Nur Mikrofon · keine Musik"
      : "Zuerst Mikrofon aktivieren";
  if (!window.MediaRecorder)
    $("record-hint").textContent =
      "Aufnahme wird in diesem Browser nicht unterstützt";
  document.querySelectorAll(".mic-row").forEach((row) => {
    row.querySelector("select").disabled = locked;
    row.querySelector(".icon-button").disabled = locked;
    row.querySelector(".mic-enable").disabled = locked;
    row.querySelector(".mic-enable").hidden = state.inputs.has(
      row.dataset.input,
    );
  });
}
function setMonitor(enabled) {
  state.monitor = enabled && state.inputs.size > 0;
  $("monitor").setAttribute("aria-checked", String(state.monitor));
  if (state.monitorGain)
    state.monitorGain.gain.setTargetAtTime(
      state.monitor ? Number($("mic-volume").value) / 100 : 0,
      state.context.currentTime,
      0.015,
    );
}
$("monitor").addEventListener("click", async () => {
  try {
    await ensureAudio();
    setMonitor(!state.monitor);
  } catch (error) {
    notice(audioError(error));
  }
});
$("mic-volume").addEventListener("input", () => {
  $("mic-volume-value").textContent = `${$("mic-volume").value} %`;
  setMonitor(state.monitor);
});
$("add-mic").addEventListener("click", () => {
  if (!state.recording && !state.starting)
    createInputRow().querySelector("select").focus();
});

async function startRecording() {
  if (!state.inputs.size || state.recording || state.starting) return;
  state.starting = true;
  updateControls();
  try {
    await ensureAudio();
    const mimeType = [
      "audio/webm;codecs=opus",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(
      state.destination.stream,
      mimeType ? { mimeType, audioBitsPerSecond: 128000 } : undefined,
    );
    state.chunks = [];
    state.bytes = 0;
    state.recorder = recorder;
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size) {
        state.chunks.push(event.data);
        state.bytes += event.data.size;
      }
      if (state.bytes >= MAX_BYTES && state.recording) {
        stopRecording();
        notice("Aufnahme beendet: 100 MB erreicht.");
      }
    });
    recorder.addEventListener("stop", () => {
      const blob = new Blob(state.chunks, {
        type: recorder.mimeType || state.chunks[0]?.type || "audio/webm",
      });
      state.chunks = [];
      if (blob.size) addClip(blob, Date.now() - state.started);
      state.recorder = null;
      state.recording = false;
      clearInterval(state.timer);
      $("record").classList.remove("is-recording");
      $("record-label").textContent = "Aufnahme starten";
      updateControls();
    });
    recorder.addEventListener("error", () => {
      stopRecording();
      notice("Die Aufnahme wurde unterbrochen. Prüfe den entstandenen Clip.");
    });
    recorder.start(1000);
    state.recording = true;
    state.started = Date.now();
    $("record-time").textContent = "00:00";
    $("record").classList.add("is-recording");
    $("record-label").textContent = "Aufnahme beenden";
    state.timer = setInterval(() => {
      const elapsed = Date.now() - state.started;
      $("record-time").textContent = formatTime(elapsed);
      if (elapsed >= MAX_TIME) {
        stopRecording();
        notice("Aufnahme beendet: 15 Minuten erreicht.");
      }
    }, 250);
  } catch (error) {
    notice(audioError(error));
  } finally {
    state.starting = false;
    updateControls();
  }
}
function stopRecording() {
  clearInterval(state.timer);
  if (state.recorder?.state !== "inactive") state.recorder?.stop();
  // Keep inputs locked until the final dataavailable/stop events have arrived.
  $("record").disabled = true;
}
$("record").addEventListener("click", () =>
  state.recording ? stopRecording() : startRecording(),
);
function addClip(blob, duration) {
  const id = ++state.clipNumber;
  const url = URL.createObjectURL(blob);
  const clip = document.createElement("article");
  clip.className = "clip";
  const top = document.createElement("div");
  top.className = "clip-top";
  const name = document.createElement("input");
  name.value = `Aufnahme ${id}`;
  name.maxLength = 80;
  name.className = "clip-name";
  name.setAttribute("aria-label", `Name von Aufnahme ${id}`);
  const actions = document.createElement("div");
  actions.className = "clip-actions";
  const download = document.createElement("button");
  download.className = "icon-button";
  download.title = "Herunterladen";
  download.setAttribute("aria-label", `Aufnahme ${id} herunterladen`);
  download.append(icon("download"));
  download.addEventListener("click", () => {
    const link = document.createElement("a");
    const extension = blob.type.includes("mp4")
      ? "m4a"
      : blob.type.includes("ogg")
        ? "ogg"
        : "webm";
    link.download = `${(name.value.trim() || `Aufnahme ${id}`).replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 80) || "Aufnahme"}.${extension}`;
    link.href = url;
    document.body.append(link);
    link.click();
    link.remove();
  });
  const remove = document.createElement("button");
  remove.className = "icon-button";
  remove.setAttribute("aria-label", `Aufnahme ${id} löschen`);
  remove.title = "Löschen";
  remove.append(icon("trash"));
  const audio = document.createElement("audio");
  audio.controls = true;
  audio.src = url;
  audio.preload = "metadata";
  audio.setAttribute("aria-label", `Aufnahme ${id}, ${formatTime(duration)}`);
  remove.addEventListener("click", () => {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    URL.revokeObjectURL(url);
    state.clips.delete(id);
    clip.remove();
    updateClips();
  });
  actions.append(download, remove);
  top.append(name, actions);
  clip.append(top, audio);
  state.clips.set(id, { url, audio });
  $("clips").prepend(clip);
  updateClips();
}
function updateClips() {
  $("empty-clips").hidden = state.clips.size > 0;
  $("clip-count").textContent =
    `${state.clips.size} ${state.clips.size === 1 ? "Clip" : "Clips"}`;
}

function setMusicTab(tab) {
  const youtube = tab === "youtube";
  $("file-tab").setAttribute("aria-selected", String(!youtube));
  $("youtube-tab").setAttribute("aria-selected", String(youtube));
  $("file-tab").tabIndex = youtube ? -1 : 0;
  $("youtube-tab").tabIndex = youtube ? 0 : -1;
  $("file-panel").hidden = youtube;
  $("youtube-panel").hidden = !youtube;
  if (youtube) $("music-player").pause();
  else youtubeCommand("pauseVideo");
}
for (const tab of ["file", "youtube"]) {
  $(`${tab}-tab`).addEventListener("click", () => setMusicTab(tab));
  $(`${tab}-tab`).addEventListener("keydown", (event) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? "file"
          : event.key === "End"
            ? "youtube"
            : tab === "file"
              ? "youtube"
              : "file";
      setMusicTab(next);
      $(`${next}-tab`).focus();
    }
  });
}
function clearMusic() {
  const audio = $("music-player");
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  if (state.musicUrl) URL.revokeObjectURL(state.musicUrl);
  state.musicUrl = null;
  $("local-player").hidden = true;
  $("drop-zone").hidden = false;
  $("music-file").value = "";
}
function openMusic(file) {
  if (!file) return;
  if (
    !file.type.startsWith("audio/") &&
    !/\.(mp3|wav|ogg|m4a|aac|flac|opus|aiff?|weba|webm)$/i.test(file.name)
  ) {
    notice("Bitte öffne eine Audiodatei, zum Beispiel MP3 oder WAV.");
    return;
  }
  clearMusic();
  setMusicTab("file");
  state.musicUrl = URL.createObjectURL(file);
  $("track-name").textContent = file.name;
  $("music-player").src = state.musicUrl;
  $("music-player").volume = 0.5;
  $("local-player").hidden = false;
  $("drop-zone").hidden = true;
}
$("music-file").addEventListener("change", (event) =>
  openMusic(event.target.files[0]),
);
$("clear-music").addEventListener("click", clearMusic);
$("replace-file").addEventListener("click", () => $("music-file").click());
$("music-player").addEventListener("error", () => {
  if (state.musicUrl)
    notice(
      "Diese Audiodatei lässt sich hier nicht abspielen. Versuche MP3 oder WAV.",
    );
});
const dropZone = $("drop-zone");
["dragenter", "dragover"].forEach((type) =>
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((type) =>
  dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  }),
);
dropZone.addEventListener("drop", (event) =>
  openMusic(event.dataTransfer.files[0]),
);
// Prevent a dropped file from navigating away and discarding the session.
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("drop", (event) => event.preventDefault());

export function youtubeId(text) {
  try {
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    let id;
    if (host === "youtu.be" || host === "www.youtu.be")
      id = url.pathname.split("/")[1];
    else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    ) {
      const parts = url.pathname.split("/");
      id =
        url.pathname === "/watch"
          ? url.searchParams.get("v")
          : ["embed", "shorts", "live"].includes(parts[1])
            ? parts[2]
            : null;
    }
    return /^[\w-]{11}$/.test(id || "") ? id : null;
  } catch {
    return null;
  }
}
function youtubeCommand(command) {
  $("youtube-player")
    .querySelector("iframe")
    ?.contentWindow.postMessage(
      JSON.stringify({ event: "command", func: command, args: [] }),
      "https://www.youtube-nocookie.com",
    );
}
let youtubeHandshake;
function stopYouTubeHandshake() {
  clearInterval(youtubeHandshake);
}
window.addEventListener("message", (event) => {
  const frame = $("youtube-player").querySelector("iframe");
  if (
    event.origin !== "https://www.youtube-nocookie.com" ||
    event.source !== frame?.contentWindow
  )
    return;
  try {
    const message =
      typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    if (message?.event === "onReady") stopYouTubeHandshake();
  } catch {
    /* Ignore unrelated messages from the embedded player. */
  }
});
$("youtube-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const id = youtubeId($("youtube-url").value.trim());
  if (!id) {
    notice("Bitte füge einen gültigen YouTube-Video-Link ein.");
    return;
  }
  $("music-player").pause();
  const iframe = document.createElement("iframe");
  iframe.title = "YouTube-Videoplayer";
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&playsinline=1&rel=0&origin=${encodeURIComponent(location.origin)}`;
  iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "strict-origin-when-cross-origin";
  stopYouTubeHandshake();
  // The embedded API needs a listening handshake before it reliably accepts
  // pause commands. No external API script or connection is needed at startup.
  iframe.addEventListener("load", () => {
    let attempts = 0;
    const listen = () => {
      iframe.contentWindow?.postMessage(
        JSON.stringify({ event: "listening", id: "klangraum" }),
        "https://www.youtube-nocookie.com",
      );
      if (++attempts >= 40) stopYouTubeHandshake();
    };
    youtubeHandshake = setInterval(listen, 250);
    listen();
  });
  $("youtube-player").replaceChildren(iframe);
  $("youtube-close").hidden = false;
  notice("");
});
$("youtube-close").addEventListener("click", () => {
  stopYouTubeHandshake();
  $("youtube-player").replaceChildren();
  $("youtube-close").hidden = true;
});
for (const id of ["info-open", "help-open"])
  $(id).addEventListener("click", () => $("info-dialog").showModal());
for (const id of ["info-close", "info-done"])
  $(id).addEventListener("click", () => $("info-dialog").close());
$("info-dialog").addEventListener("click", (event) => {
  if (event.target === $("info-dialog")) {
    const rect = event.target.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      event.target.close();
  }
});

const canvas = $("visualizer");
const paint = canvas.getContext("2d");
const samples = new Uint8Array(128);
let lastLabel = "";
function draw() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if (
    canvas.width !== Math.round(width * dpr) ||
    canvas.height !== Math.round(height * dpr)
  ) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  paint.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint.clearRect(0, 0, width, height);
  if (state.analyser && state.inputs.size)
    state.analyser.getByteFrequencyData(samples);
  else samples.fill(0);
  const bars = 35;
  const gap = 4;
  const barWidth = Math.min(6, (width - 44) / bars - gap);
  const totalWidth = bars * (barWidth + gap) - gap;
  let peak = 0;
  for (let i = 0; i < bars; i++) {
    const value = samples[Math.floor((i * samples.length) / bars)] / 255;
    peak = Math.max(peak, value);
    const barHeight = Math.max(
      5 + Math.sin(i * 1.7) * 2,
      value * (height - 20),
    );
    paint.fillStyle =
      value > 0.85 ? "#d94158" : state.inputs.size ? "#8b6bd4" : "#d1c4ed";
    paint.beginPath();
    paint.roundRect(
      (width - totalWidth) / 2 + i * (barWidth + gap),
      (height - barHeight) / 2 + 5,
      barWidth,
      barHeight,
      4,
    );
    paint.fill();
  }
  const label = state.inputs.size
    ? peak > 0.03
      ? "Dein Mikrofon hört dich."
      : "Mikrofon aktiv · gerade leise"
    : "Bereit, wenn du es bist.";
  if (label !== lastLabel) {
    $("level-label").textContent = label;
    lastLabel = label;
  }
  requestAnimationFrame(draw);
}
window.addEventListener("beforeunload", (event) => {
  if (state.recording || state.clips.size) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("pagehide", () => {
  stopYouTubeHandshake();
  setMonitor(false);
  if (state.recording) stopRecording();
  for (const id of [...state.inputs.keys()]) disconnectInput(id);
  document.querySelectorAll("audio").forEach((audio) => audio.pause());
  youtubeCommand("pauseVideo");
  for (const clip of state.clips.values()) URL.revokeObjectURL(clip.url);
  state.clips.clear();
  document.querySelectorAll(".clip").forEach((clip) => clip.remove());
  updateClips();
  clearMusic();
  state.context?.close();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) location.reload();
});
navigator.mediaDevices?.addEventListener("devicechange", refreshDevices);
createInputRow();
refreshDevices();
draw();
