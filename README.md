<p align="center">
  <img src="assets/github-logo.svg" width="40%">
</p>

**A minimal collaborative agent you can read end to end**

This repo is a stripped-down fork of [Coco](https://github.com/collaborative-agents/coco), made for teaching. Coco is a desktop agent that you chat with by text or voice and that can work on files in a folder you pick. Full Coco also watches your screen so it can step in proactively and build a memory of you. This fork removes all of that: **there is no screen sensing, no memory, and no OS permission beyond the microphone.** What is left is small enough to show how a collaborative agent works:

1. **Two collaboration primitives.** The agent can *send the user a message* and *wait for the user to continue* ([Primitives](#1-two-primitives-from-co-gym)).
2. **Two interfaces.** A desktop GUI (an avatar and a chat window) and voice (push-to-talk and a "Hey Coco" wake word) ([Interfaces](#2-interfaces-gui-and-voice)).

> If you want to see how an agent can stay aware of what the user is doing and personalize its help (screen sensing, proactive suggestions, long-term memory), see the full Coco repo: **https://github.com/collaborative-agents/coco**.

## Quickstart

```bash
# 1. Clone
git clone https://github.com/shaoyijia/mini-collaborative-agent.git
cd mini-collaborative-agent

# 2. Install packages for the Python service
uv sync

# 3. Launch the desktop app
cd desktop
npm install
npm start
```

On first launch, onboarding asks for your name, whether to turn on voice activation, the chat model(s) to use, and where the avatar should live. Voice messages are transcribed by your chat model, so pick one that accepts audio input (for example a Gemini model) if you plan to talk to Coco.

## How it's put together

```
 ┌──────────────── Desktop app (Electron) ─────────────────┐
 │  Avatar window  ·  Chat window  ·  Menu-bar / tray icon  │   GUI
 │  Mic button  ·  "Hey Coco" wake-word listener            │   voice
 │                                                          │
 │  Pi agent harness (one runtime per conversation)         │
 │   ├─ built-in tools: read / write / edit / bash          │
 │   └─ ask_user_question tool  ◄── primitive 1             │
 └───────────────▲──────────────────────────────────────────┘
                 │ authenticated loopback HTTP
 ┌───────────────┴──────── Tutor service (:8081) ───────────┐
 │  lib/proactive_tutor: model gateway, context, voice      │
 │  transcription, local wake-word worker                   │
 └──────────────────────────────────────────────────────────┘
```

- **Desktop app** (`desktop/`). It holds every user-facing surface and runs the agent loop with the [pi](https://github.com/earendil-works/pi) coding-agent SDK (`desktop/release/app/agent/`).
- **Tutor service** (`lib/proactive_tutor`). A local FastAPI server. It routes the agent's model calls to whichever provider you configure (`lib/external_api`), builds the conversation context, transcribes voice messages, and hosts the wake-word worker. The package keeps its upstream name.

## 1. Two primitives for Human-Agent Collaboration

[Collaborative Gym (Co-Gym)](https://github.com/SALT-NLP/collaborative-gym) ([paper](https://arxiv.org/abs/2412.15701)) models human–agent collaboration by giving the agent two actions beyond its task tools: **`SendTeammateMessage`**, which talks to the human, and **`WaitTeammateContinue`**, which hands control back to the human. This repo implements both.

### Send the user a message

The agent sends the user a message in two ways:

- **Its reply text.** Every turn streams Markdown into the chat as the model writes it.
- **The `ask_user_question` tool.** We turn on the [`rpiv-ask-user-question`](https://www.npmjs.com/package/@juicesharp/rpiv-ask-user-question) pi plugin, so the agent can stop mid-task and ask one or more structured questions (multiple-choice, multi-select, or free text). The run is suspended until the user answers.

### Wait for the user to continue

When the agent finishes replying, its turn ends and control goes back to the user. The pi run resolves, `runAgentTurn` in `desktop/src/main/main.ts` emits `done`, and nothing more happens until the user sends a message, answers a question card, or speaks.

The user also has these controls during and after a run:

- **Stop** aborts the run in progress. Completed file changes are kept, and the agent is told never to claim stopped work was finished.
- **Reply-ready reminder.** If the chat window is out of view, the avatar shows short progress notes while the run continues and a "Reply ready" bubble when it ends (`AgentProgressReminder`, `agent-reply-ready`).
- **Resume.** Every conversation is saved locally and can be reopened and continued later.

**This version cannot sense user activity.** While it waits, the agent sees nothing. If you want the agent to be aware of the user activity, derive useful user memory from computer use, and decide on its own when to step back in and can personalize its help, we need to add additional module to achieve this. See [collaborative-agents/coco](https://github.com/collaborative-agents/coco) for that design.

## 2. Interfaces: GUI and voice

### GUI

- **Desktop avatar**. An always-on-top pet. Click it or use its ••• menu to open chat or settings. It is also where the agent's progress and reply-ready bubbles appear. You can hide it in Settings and use the menu-bar (macOS) or tray icon instead.
- **Chat window**. This shows streamed replies, tool activity, question cards, and the Stop button. You can also pick the working folder for the conversation, switch models per conversation, view conversation history, and inspect the agent's context.
- **Global shortcut.** `Cmd/Ctrl + Shift + Space` opens the chat from anywhere.

### Voice

- **Push-to-talk.** Click the mic in the composer.
- **Wake word ("Coco", "Hi Coco", "Hey Coco").** This is off by default; turn it on in onboarding or Settings. On a detection, Coco opens the chat and starts push-to-talk recording. Wake-word audio never leaves your machine. Only the message you speak after the wake word is sent for transcription.

## Data & privacy

There is no telemetry and no Coco server. The only data that leaves your machine is what you send to the model provider you configure, which is your messages, attached images and files, and recorded voice messages. Everything else stays in the app's user-data folder. See [PRIVACY.md](PRIVACY.md) for the details.

- **macOS**: `~/Library/Application Support/coco`
- **Windows**: `%APPDATA%\coco`
- **Linux**: `$XDG_CONFIG_HOME/coco` or `~/.config/coco`

## Acknowledgement

This repo is derived from [Coco](https://github.com/collaborative-agents/coco). We thank Long Lin for designing the avatar. The execution agent builds on [pi](https://github.com/earendil-works/pi), an excellent open-source agent harness. The collaboration primitives follow [Collaborative Gym](https://github.com/SALT-NLP/collaborative-gym).

## Citation

If you use this code, please cite Coco and Co-Gym:

```bibtex
@software{coco2026,
  title        = {Coco: Proactive Co-Assistant Through Continuous Context Observation},
  author       = {Shao, Yijia and Wang, Yihan and Wang, Haowen and Yang, Diyi},
  year         = {2026},
  url          = {https://github.com/collaborative-agents/coco}
}

@article{shao2024collaborative,
  title   = {Collaborative Gym: A Framework for Enabling and Evaluating Human-Agent Collaboration},
  author  = {Shao, Yijia and Samuel, Vinay and Jiang, Yucheng and Yang, John and Yang, Diyi},
  journal = {arXiv preprint arXiv:2412.15701},
  year    = {2024}
}
```

## License

Apache License 2.0. See [LICENSE](LICENSE).
