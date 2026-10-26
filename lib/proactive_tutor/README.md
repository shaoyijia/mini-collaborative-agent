## `proactive_tutor`

A FastAPI server (the "tutor server") that connects the Coco desktop app to model providers. It owns the configured chat model, the conversation context, and voice transcription. It cannot observe the user's screen or activity: the model only sees the conversation, attached images, and its own tool results.

### How it works

```
desktop app (Pi agent harness) ──/agent/*──▶ tutor server ──▶ model provider
```

- `pi_bridge.py` exposes `/agent/*` to the Pi agent harness in the desktop app: per-conversation context (`/agent/sessions/{id}`), an OpenAI-compatible streaming completion endpoint (`/agent/v1/chat/completions`) backed by the configured model, tool execution, voice transcription, and turn recording.
- `TutorSystem` keeps the chat history and builds ordinary system/user/assistant messages from it (`prompts_everyday/tutor.txt`), so `/events/user_prompt` and `/events/audio_prompt/stream` can also run a turn directly.
- `wake_word_worker.py` is a separate local sherpa-onnx process the desktop app launches for "Hey Coco" voice activation.

### Usage

```bash
uv run python -m proactive_tutor.tutor_server \
    --model_name=<provider/model> \
    --port=8081

# Wake-word worker (reads 16 kHz mono s16le PCM on stdin, writes JSON lines)
uv run --package proactive_tutor python -m proactive_tutor.wake_word_worker \
    --model-dir <sherpa-onnx kws model dir> --state-dir <dir>
```

### Training data

When `$COCO_RECORDS_DIR` is set (the desktop launcher sets it), every tutor LLM call is appended to `tutor_calls.jsonl`.
