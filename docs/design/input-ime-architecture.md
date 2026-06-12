# Input / IME architecture

How keystrokes travel from the OS to the PTY, why macOS needs a custom IME mirror, the
rules that keep it from corrupting input, the diagnostics around it, and the built-in
self-test harness that gates every release. Distilled from the #83/#84/#88 bug series
(v0.13.x–v0.14.x); see `docs/work-log/` for the blow-by-blow.

## The platform split

xterm.js receives input through a hidden `<textarea>` (the *helper textarea*). How CJK
composition reaches that textarea differs per WebView, so the app has **two input paths**,
selected by `isMacWebView` in `src/components/Terminal.tsx`:

| Platform | WebView | CJK path |
|---|---|---|
| Windows | WebView2 | xterm native IME (standard composition events) |
| Linux | WebKitGTK | xterm native IME (standard composition events) |
| macOS | WKWebView | **custom IME mirror** (below) |

Windows/Linux fire the standard `compositionstart/update/end` sequence and xterm's own
`CompositionHelper` handles it. The mirror, the `.composition-view` CSS hiding, the stray
jamo filter, and the keyCode-229 interception are all **macOS-only**; applying any of them
to Windows/Linux breaks native IME (the root cause of the #84/#88 Hangul-stuck series).

## The macOS mirror

On macOS WKWebView (all recent versions we've seen), Korean input arrives as **keydown
keyCode 229 only — no composition events at all** (measured on the maintainer's Mac:
`n229:33, nCS:0`). xterm's native handling can't see the composed syllables, so:

- A keydown with `keyCode === 229` is intercepted (`attachCustomKeyEventHandler` returns
  false) and sets `imeActive`. While `imeActive`, `term.onData` output is ignored —
  whatever xterm leaks during composition is *not* sent.
- Instead the textarea is *mirrored*: on each `input` event, `flushMirror` diffs the
  textarea content against the last-sent state (`imeSent`) and sends the delta to the
  PTY — backspaces for the rewound suffix, then the new characters.

### Mirror rules (each one is a scar)

1. **Engagement baseline (#97).** When the mirror engages (first 229 while inactive),
   `imeSent` is snapshotted from the textarea's *current* content, not assumed empty.
   xterm's paste handler calls `stopPropagation` but not `preventDefault`, so WebKit's
   default action leaves the pasted text in the textarea; an empty baseline re-sent it on
   the next keystroke. A `paste` listener also clears the residue on the next tick.
2. **ASCII multi-backspace suppression (#83, v0.14.2).** A rewrite that would erase 2+
   characters of pure-ASCII content is not sent. macOS predictive features rewrite the
   textarea behind the user's back; a terminal wants raw keystrokes, so OS-driven rewrites
   are dropped while real typing (appends, single backspaces) and genuine CJK composition
   rewinds pass through. Measured safe for Hangul (`bsSuppressed:0` during Korean typing).
3. **`nativeComposition` is a window, not a latch (#83, v0.14.3).** If real composition
   events *do* fire (press-and-hold accents, dictation), the mirror yields to them — but
   only while the composition is actually in progress (+~80 ms). Latching permanently
   killed Korean for the rest of the session on 229-only machines.
4. **Stray jamo filter.** While engaging, xterm sometimes leaks a lone compatibility jamo
   (U+3130–U+318F) through `onData`; single jamo are dropped — on macOS only, since on
   Windows/Linux a lone jamo can be a legitimate native-IME commit.
5. **`writingsuggestions="false"`** is set on the textarea (xterm only disables
   autocorrect/autocapitalize/spellcheck). Helps on most Macs; was not sufficient on the
   #83 machine.

## Diagnostics (temporary, removed when #83 closes)

`wt-ime-diag2` is sent to GlitchTip on input idle (3 s debounce, max 4 sends per run,
macOS only) and accumulated without limit in `localStorage["wt.ime.local-diag"]`:

- Counters: `n229`, `nCS/nCU/nCE` (composition events), `onDataChars` (normal-path chars
  sent), `mirrorChars/mirrorBs` (mirror-path), `bsSuppressed` (rule 2 hits).
- `ring`: last 14 mirror transitions (previous → current textarea content).
- Since v0.14.8 (the #83 artifact survived with a *clean* input path — `df -h` sent
  exactly 6 chars yet still displayed `ddf -hdff f -h`): `rend` (WebGL addon active,
  context losses, cols/rows), `lines` (buffer text of the cursor line + 3 above — artifacts
  in the buffer mean the echo/parsing side, a clean buffer means the renderer), and `echo`
  (last 10 PTY output chunks, escaped). These capture terminal content; they exist solely
  to finish #83 and must be removed with it.

Reading the local dump without the app's help: the WKWebView localStorage sqlite is at
`~/Library/WebKit/wowterminal/...{hash}.../LocalStorage/localstorage.sqlite3` for the bare
binary (`com.wowterminal.app` for the installed bundle); values are UTF-16LE.

## Built-in input self-test harness (#95) — the release gate

External keystroke automation (System Events) does not reach the app in every desktop
setup (Spaces/multi-display), so the app can test itself. `src/inputSelfTest.ts`:

- Armed by a one-shot localStorage flag `wowterminal.selftest = "1"`; the next launch
  consumes the flag, **skips session restore** (synthetic input must only ever touch a
  fresh local tab), runs the scenarios, and is inert on every launch after that.
- Drives the real paths with synthetic events: bulk `insertText` for plain typing
  (per-key keydown synthesis stalls nondeterministically), Backspace keydowns, and the
  mirror via keyCode-229 keydown + textarea value transitions (growth = composition,
  shrink = deletion), plus a paste + residue simulation.
- Verification is external and byte-exact — each scenario makes the shell write a file:

| Scenario | Path | Expected |
|---|---|---|
| T1 plain typing + Backspace | `/tmp/wt-st1.txt` | `st-en-abcxyz` |
| T2 mirror composition | `/tmp/wt-st2.txt` | `안녕` |
| T3 composition + deletion | `/tmp/wt-st3.txt` | `가나` |
| T4 paste residue (#97) | `/tmp/wt-st4.txt` | `PB123가` (paste exactly once) |
| completion marker | `/tmp/wt-st-done.txt` | — |

- Progress trace + 0.5 s heartbeat go to `localStorage["wt.selftest.trace"]` so a stalled
  driver can be told apart from a dead WebView.

**Gate procedure** (standing order: input is verified before every release): quit the app
→ back up the live localStorage sqlite (the session snapshot lives there) → inject the
flag → launch the release binary → assert the `/tmp/wt-st*` files → restore the snapshot
and relaunch. T1–T4 have gated v0.14.6, v0.14.7 and v0.14.8.

## Open investigation

- **#83 (newest-Mac `ddf` artifacts):** input path proven clean as of v0.14.7; the
  remaining split (echo/parsing vs renderer) is what the v0.14.8 diag decides.
- **Hangul deletion gaps (one reported Mac):** suspicion is the textarea's own composition
  feeding stray jamo + spaces; the transition `ring` exists to confirm. Waiting for data
  from a 0.14.4+ build.
