# Privacy

## Components: inputs and outputs

Coco runs two local processes that talk to each other over `localhost`.

### Desktop app (Electron)

The avatar, chat window, and the pi agent harness.

| | |
|---|---|
| **Input** | Your chat messages, pasted images, attached file paths, voice recordings, question-card answers, and settings. |
| **Output** | Runs each agent turn through the tutor service. The agent's file and command tools act only on the working folder you choose for the conversation. That folder is a working directory, not a sandbox. Writes settings and conversations to the user-data folder (see [footprint](#on-disk-footprint)). |
| **Network** | Loopback only, unless you connect a model provider directly through Pi. In that case the agent's model calls go straight to that provider. |

### Tutor service (`lib/proactive_tutor`)

| | |
|---|---|
| **Input** | Requests from the desktop app: the conversation, your messages and images, and voice recordings to transcribe. |
| **Output** | Calls the chat model you configured. Returns streamed replies and transcripts to the desktop app. |
| **Wake word** | When voice activation is on, the desktop app streams microphone audio to a local [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) keyword spotter (`wake_word_worker.py`). That audio is processed in memory and is **never** sent to a model or written to disk. |

## What is sent to the model provider

Each agent turn sends the following to the chat model in your settings:

- the conversation so far, the agent's instructions, and your name;
- any images you pasted into the message;
- the output of tools the agent ran, such as file contents it read or command output in your working folder.

A voice message is sent to the same model to be transcribed. Only the recording you make after pressing the mic, or after saying the wake word, is sent.

There is no Coco backend. Requests go directly from your machine to your provider's endpoint, authenticated with your own credentials. Your provider choice therefore determines where your messages go. For stronger guarantees, use a self-hosted model, a Trusted Execution Environment provider, or an unlinkable relay. See [lib/external_api/README.md](lib/external_api/README.md).

## On-disk footprint

Everything Coco stores lives in the app's user-data folder. Delete the folder and every trace of Coco is gone:

- **macOS**: `~/Library/Application Support/coco`
- **Windows**: `%APPDATA%\coco`
- **Linux**: `$XDG_CONFIG_HOME/coco` or `~/.config/coco`

| File | Contents |
|---|---|
| `coco-profile.json` | Onboarding settings: your name and whether the avatar is hidden |
| `coco-model-config.json` | The chat models you configured |
| `coco-model-credentials.json` | API keys you entered in the app (file mode `0600`) |
| `chat-conversations.json` | Chat transcripts, including pasted images, shown in conversation history |
| `pi/` | The agent harness's per-conversation session history and provider login |
| `workspace/` | The default working folder for new conversations |
| `wake-word.json`, `wake-word/` | Whether voice activation is on, and the keyword spotter's state |
| `coco-records/session_<ts>/tutor_calls.jsonl` | One row per tutor-model call (prompt and reply), for debugging and research |
| `logs/` | The wake-word worker's log |

The tutor service writes its log next to the desktop app (`desktop/logs/tutor-server.log` when run from source). It can contain message text, so treat it like the records above.

API keys you put in a developer `.env` file stay in that file and are used only to authenticate with your chosen provider.
