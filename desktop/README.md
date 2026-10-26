## `desktop`

The Electron + React shell that hosts Coco's avatar, chat, and onboarding UI. It spawns the Python tutor service (`proactive_tutor`) and the local wake-word worker as child processes and talks to them over local HTTP and stdio. Coco does not observe the screen: the only inputs are what the user types, says, pastes, or attaches.

### Local agent execution

Chat runs through the bundled pi harness. It can read, edit, and write files and
run commands in the conversation's selected working folder. The folder is a
working directory, not a sandbox. Tool activity, interactive questions
(`ask_user_question`), Stop, context inspection, pasted images, and voice input
are available in the chat.

Models and provider credentials are configured locally in onboarding or Settings.
The pi runtime calls the local tutor service through an authenticated loopback
bridge; that service uses the configured model providers. There is no hosted Coco
login, gateway, or memory.

Each conversation retains its folder and pi session history and owns an independent
runtime. Multiple conversations can run concurrently; only a second run in the same
conversation is blocked. Stop and question answers target a specific request.
Main persists live replies so switching conversations or closing the chat window
does not discard work. History marks active conversations as “Working…”.

The local bridge isolates each conversation's model, history, and tools using an
`X-Coco-Session` header. Native Pi login remains an alternative direct-provider
path, including when the Python service is unavailable. Changing global provider
credentials or restarting services requires waiting for active runs; selecting a
model or folder for an idle conversation does not stop other conversations.

Sleep pauses wake-word capture while chat and background agent runs continue.
The avatar shows brief progress/completion reminders when chat is out of view.
Its bubble and menu use separate windows so opening them does not resize or move
the pet. Chat uses normal window stacking with an optional pin.

The composer accepts local file references through Attach files or drag-and-drop,
and pasted images.

The native ESM runtime and SDK dependencies live under `release/app/agent` and
`release/app/node_modules`; packaging must include `agent/**`. After changing
agent dependencies, install them with `npm --prefix release/app ci` from this
directory. Validate with `npm run typecheck`, `npm test -- --runInBand`,
`npm run test:agent`, and `npm run build`. The agent integration test uses a local
mock HTTP server and does not call a real model.

### Folder structure

```
desktop/
├── src/
│   ├── main/                          # Electron main process
│   │   ├── main.ts                    # Window lifecycle, IPC handlers, service orchestration
│   │   ├── preload.ts                 # contextBridge — exposes a typed IPC API to the renderer
│   │   ├── conversation-store.ts      # Persists chat conversations to disk
│   │   ├── model-config-store.ts      # Model connections and credentials
│   │   ├── menu.ts                    # macOS menu bar
│   │   ├── util.ts                    # Dev/prod URL resolver (resolveHtmlPath)
│   │   └── services/
│   │       ├── manager.ts             # Spawns and manages the Python child process
│   │       ├── agent-runs.ts          # One pi harness per conversation; Stop and answers
│   │       ├── pi-harness.ts          # Runs one agent turn against the tutor service
│   │       ├── wake-word-service.ts   # Feeds microphone audio to the wake-word worker
│   │       └── config.json            # Service definitions (ports, commands, env vars)
│   │
│   ├── renderer/                      # React 19 UI
│   │   ├── index.tsx                  # Entry — routes to views based on ?view= query param
│   │   ├── App.tsx                    # Default view: pet avatar + agent bubbles
│   │   ├── voice-recorder.ts          # Push-to-talk recording (WAV)
│   │   └── components/
│   │       ├── OnboardingView.tsx     # First-run setup (name, voice, models, avatar)
│   │       ├── SessionChatView.tsx    # Full chat panel
│   │       ├── chat/QuestionCard.tsx  # ask_user_question card
│   │       ├── AgentBubble.tsx        # "Working" / "Reply ready" bubble beside the avatar
│   │       ├── WakeWordCaptureView.tsx # Hidden microphone capture for the wake word
│   │       ├── PetSprite.tsx          # Animated avatar sprite with mood states
│   │       └── agent-types.ts         # Shared chat, tool-call, and pet types
│   │
│   └── __tests__/                     # Jest + Testing Library tests
│
├── release/app/agent/                 # pi runtime + ask-user extension (native ESM)
├── .erb/                              # Electron React Boilerplate tooling
│   ├── configs/                       # Webpack configs (main, renderer, preload, DLL)
│   └── scripts/                       # Build helpers (Python bundling and service copy)
│
├── assets/                            # App icons, pet sprite images, wake-word model
└── release/
    ├── app/                           # electron-builder app directory (prod entry point)
    └── build/                         # Packaged installers (DMG, NSIS, AppImage)
```

### Multi-window design

A single React bundle is loaded into several `BrowserWindow` instances, each routed by the `?view=` query parameter:

| Window | `?view=` | Purpose |
|---|---|---|
| **Avatar** | _(default)_ | Transparent, always-on-top pet sprite |
| **Avatar bubble** | `avatar-bubble` | Agent progress and reply-ready reminders beside the pet |
| **Avatar menu** | `avatar-menu` | The pet's ••• menu |
| **Onboarding** | `onboarding` | First-run configuration wizard |
| **Chat** | `session` | Full conversation panel |
| **Image preview** | `image-preview` | Full-display preview of chat images |
| **Wake-word capture** | `wake-word-capture` | Hidden 1 px window that streams microphone audio |

### How the main process orchestrates everything

1. On first launch, collects the chat model settings; credentials are stored in a
   plaintext configuration file protected with owner-only permissions
   (`chmod 600`) in Electron's user-data directory
2. Checks whether onboarding is complete; if not, opens the onboarding window
3. `ServiceManager` spawns the tutor service (`:8081`) with the configured
   credentials; development `.env` remains supported
4. Chat and voice messages go to `runAgentTurn`, which runs one pi agent turn
   through the tutor service and streams the result to the chat renderer
5. When the turn ends, the agent waits for the user; if the chat is out of view,
   the avatar shows a reply-ready bubble

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Dev mode — webpack-dev-server on `:1212` + Electron with hot reload |
| `npm run build` | Production webpack build (main + renderer) |
| `npm run build:services` | Bundle the Python executables (`tutor-server`, `wake-word-worker`) into one shared `service-dist/coco-services/` runtime |
| `npm run package` | Full production build + electron-builder (DMG / NSIS / AppImage) |
| `npm test` | Run Jest unit tests |

### Signed macOS releases

macOS packaging requires a valid `Developer ID Application` identity and fails
instead of producing an unsigned app. On a local build Mac, install the
certificate and its private key in the login keychain, then verify it with:

```bash
security find-identity -v -p codesigning
```

For notarization, create an Apple app-specific password and provide the
credentials only in the packaging shell or CI secret store:

```bash
export APPLE_ID="your-apple-account@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TXPTCX3TMU"

npm run package
```

Electron-builder automatically selects the installed `Developer ID
Application` identity. If a build Mac has multiple matching identities, set
`CSC_NAME` to a qualifier such as `Yijia Shao (TXPTCX3TMU)`; do not include the
`Developer ID Application:` prefix.

Do not put the certificate, private key, or notarization credentials in the
repository or application `.env`. Electron-builder signs with Hardened Runtime,
submits the app through Apple notary service, and staples the accepted ticket.
After packaging, verify each generated `.app` with:

```bash
codesign --verify --deep --strict --verbose=2 "release/build/mac-arm64/coco.app"
spctl --assess --verbose --type exec "release/build/mac-arm64/coco.app"
xcrun stapler validate "release/build/mac-arm64/coco.app"
```

The output directory can be `release/build/mac` for an x64 build.

To test the first-launch flow without changing your normal profile, point the
development app at a fresh directory:

```bash
export COCO_TEST_DATA="$(mktemp -d /tmp/coco-model-test.XXXXXX)"
COCO_DESKTOP_USER_DATA_DIR="$COCO_TEST_DATA" npm start
```

### Dependency compatibility checks

`uv.lock` pins the Python dependency versions used by development, CI, and
release builds. CI runs `uv sync --locked`; changing a dependency requires
regenerating and committing the lockfile with the manifest change. To upgrade
one dependency, run `uv lock --upgrade-package <package>` and review the diff.

The Dependency compatibility workflow tests Python 3.12 on Apple Silicon,
Intel macOS, and Windows. It checks installed requirements and sends real
synchronous and asynchronous LiteLLM tool calls to a local HTTP server. It needs
no provider credentials and does not call a real model. Run it locally with:

```bash
uv run --locked python -m external_api.dependency_smoke
```

Release builds repeat this check before packaging, then run
`tutor-server --dependency-smoke-test` from the frozen services bundle before
signing. A failure stops the release before installers are published.

### Native Pi provider login

In **Settings → Models & providers → Agent connection** (also available during
onboarding), choose a Pi provider and sign in with its OAuth button or enter an API
key. Complete the browser/device-code flow or paste the callback when prompted,
choose a model, then click **Use native Pi**. **Use Coco bridge** switches back to
the existing local Python model configuration.

Pi owns provider authentication and token refresh. Credentials are stored in the
SDK's `pi/auth.json` under Electron's user-data directory; they are not sent to the
renderer or to a hosted Coco backend. This is a local credential file, not an OS
keychain. The connection selection is stored separately in `pi-connection.json`.
Sign out removes the selected provider's stored Pi credentials (environment-provided
credentials, if any, are managed outside the app).

Native text/image chat and Pi's file/command tools do not require Python services.
When the local Coco service is running, its context and tools remain available.
Voice transcription still requires the local service and its model configuration. Native login alone does not configure
those services. Native-only users can finish onboarding after choosing a Pi model.
