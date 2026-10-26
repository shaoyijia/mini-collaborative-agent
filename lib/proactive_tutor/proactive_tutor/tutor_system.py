import json
import os
import time
from collections.abc import Callable
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any

from external_api.types import LLMCallMetrics
from proactive_tutor.agents.tutor import TutorAgent
from proactive_tutor.ai_tool_capabilities import (
    format_tool_names,
    get_capabilities_for_tools,
)
from proactive_tutor.audio_input import validate_wav_base64
from py_utils.logging import init_logger
from py_utils.training_recorder import TrainingRecorder

logger = init_logger(__name__)


class TutorSystem:
    """
    Conversation manager for chat with the user.

    Uses ordinary system/user/assistant messages. The agent only knows what is
    in the conversation (plus attached images and its own tool results); it
    cannot observe the user's screen or activity.

    Exposed over HTTP by tutor_server.py.
    """

    def __init__(
        self,
        model_name: str,
        scenario: str = "everyday_support",
    ):
        self._scenario = scenario
        prompts_dir = self._prompts_dir(scenario)
        self.tutor_agent = TutorAgent(
            model_name,
            (prompts_dir / "tutor.txt").read_text(encoding="utf-8"),
        )

        self.problem_statement: str = ""
        self.user_name: str = (os.environ.get("COCO_USER_NAME") or "").strip()
        self.conversation_history: list[str] = []
        # Provider-ready chat history for everyday support. Unlike
        # conversation_history (the legacy API/debug representation), this
        # preserves normal user/assistant message boundaries.
        self._chat_messages: list[dict[str, str]] = []
        self.image_num: int = 0

        # Training-data recorder — only active when the launcher set a shared
        # records dir ($COCO_RECORDS_DIR).
        self._recorder: TrainingRecorder | None = (
            TrainingRecorder(os.environ["COCO_RECORDS_DIR"])
            if os.environ.get("COCO_RECORDS_DIR")
            else None
        )

        # ── AI tools context ──────────────────────────────────────────────────
        # Populated by set_ai_tools() after the session starts.
        self._ai_tools: list[str] = []
        self._ai_tools_capability_text: str = ""

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _prompts_dir(scenario: str) -> Path:
        """Return the prompts directory. Every scenario uses prompts_everyday/."""
        return Path(__file__).parent / "prompts_everyday"

    def _log_tutor_call(
        self,
        trigger: str,
        tutor_input: str,
        tutor_output: str,
        image_paths: list[str] | None,
        llm_metrics: dict | None = None,
        *,
        session_id: str | None = None,
        event_ts: float | None = None,
    ) -> None:
        """Record the tutor LLM call (input + generated guidance) for training."""
        if self._recorder is None:
            return
        try:
            self._recorder.log_tutor(
                ts=event_ts if event_ts is not None else time.time(),
                session_id=session_id,
                trigger=trigger,
                scenario=self._scenario,
                model=getattr(self.tutor_agent, "model", ""),
                tutor_input=tutor_input,
                tutor_output=tutor_output,
                image_paths=image_paths,
                llm_metrics=llm_metrics,
            )
        except Exception as e:
            logger.debug(f"[TUTOR] failed to log tutor call: {e}")

    def _ai_tools_context_block(self) -> str:
        """Build an <ai_tools_context> XML block for the current session.

        Returns an empty string when no tools have been configured (e.g. the
        user skipped the onboarding step or the field wasn't forwarded yet).
        """
        if not self._ai_tools_capability_text:
            return ""
        tool_list = format_tool_names(self._ai_tools)
        return (
            "<ai_tools_context>\n"
            f"The user has access to the following AI tool(s): {tool_list}\n\n"
            f"{self._ai_tools_capability_text}\n"
            "</ai_tools_context>"
        )

    # ------------------------------------------------------------------
    # Configuration
    # ------------------------------------------------------------------

    def set_model(self, model_name: str) -> None:
        """Reconfigure the tutor agent to use a different model."""
        logger.info(f"[SET MODEL] {model_name}")
        prompts_dir = self._prompts_dir(self._scenario)
        self.tutor_agent = TutorAgent(
            model_name,
            (prompts_dir / "tutor.txt").read_text(encoding="utf-8"),
        )

    def set_ai_tools(self, tool_ids: list[str]) -> None:
        """Configure which AI tools the user has access to for this session.

        Pre-computes the capability text so _ai_tools_context_block() is free
        at call time.  Call this once per session, after reset_session().
        """
        self._ai_tools = list(tool_ids)
        self._ai_tools_capability_text = get_capabilities_for_tools(tool_ids)
        logger.info(f"[AI TOOLS] Configured: {tool_ids}")

    def set_user_name(self, user_name: str) -> None:
        """Configure the preferred name exposed to the tutor prompt."""
        self.user_name = (user_name or "").strip()
        logger.info("[USER NAME] Configured for tutor context")

    def set_scenario(self, scenario: str) -> None:
        """Switch to a different scenario, reloading prompts for the current model."""
        logger.info(f"[SET SCENARIO] {scenario}")
        self._scenario = scenario
        prompts_dir = self._prompts_dir(scenario)
        model_name = self.tutor_agent.model
        self.tutor_agent = TutorAgent(
            model_name,
            (prompts_dir / "tutor.txt").read_text(encoding="utf-8"),
        )

    def reset_session(self) -> None:
        """Clear all per-session state so a new session starts fresh.

        Called by the tutor server's POST /context/reset endpoint whenever the
        desktop app starts a new conversation.
        """
        logger.info("[RESET] Clearing per-session state for new session")
        self.conversation_history = []
        self._chat_messages = []
        self.problem_statement = ""
        self.image_num = 0
        self._ai_tools = []
        self._ai_tools_capability_text = ""

    def restore_conversation(self, messages: list[dict[str, str]]) -> None:
        """Restore user/tutor turns from a locally saved chat transcript."""
        restored: list[dict[str, str]] = []
        legacy_history: list[str] = []
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        for message in messages:
            role = message.get("role")
            text = message.get("text", "").strip()
            if role not in {"user", "tutor"} or not text:
                continue
            provider_role = "user" if role == "user" else "assistant"
            restored.append({"role": provider_role, "content": text})
            label = "User" if role == "user" else "Tutor"
            legacy_history.append(f"[{ts}] [{label}]: {text}")

        self._chat_messages = restored
        self.conversation_history = legacy_history

    def handle_problem_statement(self, text: str) -> None:
        logger.info(f"[PROBLEM STATEMENT] {text}")
        # with open("debug_text_prompt.txt", "a") as f:
        #     f.write(f"\n[PROBLEM STATEMENT] {text}\n")
        #     f.write("\n\n=== End of problem statement ===\n")
        self.problem_statement = text

    # ------------------------------------------------------------------
    # Context  (exposed via GET /context)
    # ------------------------------------------------------------------

    def get_kargs(self) -> dict:
        return {
            "conversation_history": self.conversation_history,
            "problem_statement": self.problem_statement,
            "image_num": self.image_num,
            "ai_tools": self._ai_tools,
        }

    def _everyday_chat_messages(
        self, current_message: dict[str, Any] | None = None
    ) -> list[dict[str, Any]]:
        """Build normal chat messages, with the user's name as system context."""
        user_name_block = self._user_name_context_block()
        messages = [
            *(
                [{"role": "system", "content": user_name_block}]
                if user_name_block
                else []
            ),
            *[dict(message) for message in self._chat_messages],
        ]
        if current_message is not None:
            messages.append(current_message)
        return messages

    def _user_name_context_block(self) -> str:
        """Build the prompt block containing the user's preferred name."""
        if not self.user_name:
            return ""
        return f"<user_name>\n{escape(self.user_name)}\n</user_name>"

    def _handle_everyday_user_prompt(
        self,
        *,
        image_paths: list[str] | None,
        user_text: str | None,
        on_event: Callable[[dict], None] | None = None,
    ) -> tuple[str, LLMCallMetrics]:
        text = (user_text or "").strip() or "Hi."
        current_message = {"role": "user", "content": text}
        messages = self._everyday_chat_messages(current_message)
        if on_event is None:
            response, metrics = self.tutor_agent.chat_with_metrics(
                messages,
                image_paths=image_paths,
            )
        else:
            response, metrics = self.tutor_agent.chat_with_metrics(
                messages,
                image_paths=image_paths,
                on_event=on_event,
            )

        self._chat_messages.extend(
            [current_message, {"role": "assistant", "content": response}]
        )
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.conversation_history.extend(
            [f"[{ts}] [User]: {text}", f"[{ts}] [Tutor]: {response}"]
        )
        serialized_messages = json.dumps(messages, ensure_ascii=False)
        self._log_tutor_call(
            "user_prompt",
            serialized_messages,
            response,
            image_paths,
            llm_metrics=metrics,
        )
        return response, metrics

    # ------------------------------------------------------------------
    # Event handlers
    # ------------------------------------------------------------------

    def handle_user_prompt(
        self,
        image_paths: list[str] | None = None,
        user_text: str | None = None,
        on_event: Callable[[dict], None] | None = None,
    ) -> str:
        guidance, _ = self.handle_user_prompt_with_metrics(
            image_paths=image_paths,
            user_text=user_text,
            on_event=on_event,
        )
        return guidance

    def handle_user_prompt_with_metrics(
        self,
        image_paths: list[str] | None = None,
        user_text: str | None = None,
        on_event: Callable[[dict], None] | None = None,
    ) -> tuple[str, LLMCallMetrics]:
        """
        Process a user-prompt event.

        Args:
            image_paths: Optional image file paths attached by the user, embedded
                         directly in the LLM call.
            user_text:   The raw text the user typed, used to record the user
                         turn in conversation_history with a timestamp.

        Returns:
            Tutor guidance string.
        """
        logger.info(
            f"[USER_PROMPT] Handling user prompt event. "
            f"images={len(image_paths) if image_paths else 0}"
        )
        guidance, metrics = self._handle_everyday_user_prompt(
            image_paths=image_paths,
            user_text=user_text,
            on_event=on_event,
        )
        logger.info(f"[TUTOR] {guidance}")
        return guidance, metrics

    def handle_audio_prompt_with_metrics(
        self,
        audio_data: str,
        on_event: Callable[[dict], None] | None = None,
        session_id: str | None = None,
    ) -> tuple[str, LLMCallMetrics]:
        """Process a WAV voice message with the current tutor agent."""
        event_ts = time.time()
        logger.info("[AUDIO_PROMPT] Handling voice message")
        validate_wav_base64(audio_data)
        audio_message = {
            "role": "user",
            "content": [
                {
                    "type": "input_audio",
                    "input_audio": {"data": audio_data, "format": "wav"},
                }
            ],
        }
        messages = self._everyday_chat_messages(audio_message)
        guidance, metrics = self.tutor_agent.chat_with_metrics(
            messages,
            on_event=on_event,
        )

        # Raw audio is intentionally not retained. Keep a compact turn marker so
        # the answer remains part of the same typed/voice conversation.
        voice_marker = "[Voice message]"
        self._chat_messages.extend(
            [
                {"role": "user", "content": voice_marker},
                {"role": "assistant", "content": guidance},
            ]
        )
        ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        self.conversation_history.extend(
            [f"[{ts}] [User]: {voice_marker}", f"[{ts}] [Tutor]: {guidance}"]
        )
        self._log_tutor_call(
            "audio_prompt",
            voice_marker,
            guidance,
            None,
            llm_metrics=metrics,
            session_id=session_id,
            event_ts=event_ts,
        )
        logger.info(f"[TUTOR] {guidance}")
        return guidance, metrics
