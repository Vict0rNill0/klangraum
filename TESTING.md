# Verification

## Automated browser checks (2026-11-18)

19 applicable checks passed across Chromium, Firefox and WebKit. Two WebKit recording checks are explicitly skipped: Playwright's Linux WebKit build does not expose `MediaRecorder`. Its disabled recording state is checked. This is not a physical Safari/iPhone test.

| Check                                                                                     | Chromium | Firefox | Linux WebKit              |
| ----------------------------------------------------------------------------------------- | -------- | ------- | ------------------------- |
| German UI, dialog, 320–1920 px layouts, no external startup traffic or persistent storage | Pass     | Pass    | Pass                      |
| Local WAV playback, global pause, reload cleanup                                          | Pass     | Pass    | Pass                      |
| Opt-in YouTube embedding, URL validation, pause command, close                            | Pass     | Pass    | Pass                      |
| Denied microphone permission and safe control state                                       | Pass     | Pass    | Pass                      |
| Record audible microphone, decode audio, play, rename, download, delete, reload           | Pass     | Pass    | Unsupported in test build |
| Silent microphone + playing music produces a silent recording                             | Pass     | Pass    | Unsupported in test build |
| Multiple inputs, duplicate prevention, input removal                                      | Pass     | Pass    | Pass                      |

Microphones are synthetic: Chromium/Firefox use browser fake devices for the main recording check; multiple inputs and isolation use Web Audio-generated streams. A deterministic mock models hardware disconnection during recording in Chromium/Firefox. YouTube iframe messaging is tested against a controlled embedded fixture, independent of internet availability or individual video restrictions.

Desktop and mobile screenshots were reviewed. No horizontal overflow at 320, 390, 1440 or 1920 px.

## Live deployment

GitHub Pages deployed successfully to <https://victornillo.com/klangraum/> with HTTPS enforced. A live Chromium smoke test connected a synthetic microphone, recorded and played a clip, verified the mobile layout, and found no JavaScript errors or external startup requests. A real YouTube embed loaded its title and thumbnail. Full YouTube streaming was not confirmed in headless testing and remains part of the real-device check below.

## Running the checks

```sh
npm ci
npx playwright install --with-deps chromium firefox webkit
npm test -- --workers=4
```

On RIG the missing WebKit gamepad libraries were downloaded/extracted under `/tmp/opencode/klangraum-webkit-libs`, without changing the system. The WebKit wrapper overrides `LD_LIBRARY_PATH`, so the local test invocation used:

```sh
LD_PRELOAD="/tmp/opencode/klangraum-webkit-libs/usr/lib/x86_64-linux-gnu/libhidapi-hidraw.so.0:/tmp/opencode/klangraum-webkit-libs/usr/lib/x86_64-linux-gnu/libmanette-0.2.so.0" npm test -- --workers=4
```

## Real-device acceptance

Open the live HTTPS site on the target computer, phone and school screen. Allow microphone access, check the input labels and level, record a short voice clip, then play/download it. Start amplification quietly and judge delay/feedback with the actual speakers. Connect a second microphone if available. Try an embeddable YouTube video on the school's network. Physical microphone enumeration, feedback, Bluetooth delay and school network filtering require these real devices.
