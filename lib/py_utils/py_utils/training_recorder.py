"""Append-only training-data recorder for the tutor service.

Writes ``tutor_calls.jsonl`` — one row per TUTOR LLM call: full prompt +
generated reply — into the per-run directory the launcher selects via the
``COCO_RECORDS_DIR`` environment variable.

All writes are best-effort: any failure is swallowed so data collection can
never break the live pipeline.
"""

from __future__ import annotations

import json
import os
import threading
from pathlib import Path

from py_utils.logging import init_logger

logger = init_logger(__name__)


class TrainingRecorder:
    """Best-effort writer for tutor-call training rows."""

    def __init__(self, out_dir: str) -> None:
        self._dir = Path(os.path.expanduser(out_dir))
        self._lock = threading.Lock()
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
        except OSError as e:
            logger.warning(f"TrainingRecorder: could not create {self._dir}: {e}")
        logger.info(f"TrainingRecorder writing to {self._dir}")

    # ------------------------------------------------------------------
    # Rows
    # ------------------------------------------------------------------

    def log_tutor(
        self,
        *,
        ts: float,
        session_id: str | None,
        trigger: str,
        scenario: str,
        model: str,
        tutor_input: str,
        tutor_output: str,
        image_paths: list[str] | None = None,
        llm_metrics: dict | None = None,
    ) -> None:
        """Log one tutor LLM call (the delivered-assistance content).

        ``session_id`` is passed explicitly because the tutor process tracks
        the active session itself.
        """
        row = {
            "session_id": session_id,
            "ts": ts,
            "trigger": trigger,  # "user_prompt" | "audio_prompt" | "pi_agent"
            "scenario": scenario,
            "model": model,
            "tutor_input": tutor_input,
            "tutor_output": tutor_output,
            "image_paths": list(image_paths or []),
        }
        if llm_metrics is not None:
            row["llm_metrics"] = llm_metrics
        self._append(self._dir / "tutor_calls.jsonl", row)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _append(self, path: Path, row: dict) -> None:
        try:
            line = json.dumps(row, default=str)
            with self._lock:
                with open(path, "a") as f:
                    f.write(line + "\n")
        except Exception as e:
            logger.debug(f"TrainingRecorder: append to {path.name} failed: {e}")
