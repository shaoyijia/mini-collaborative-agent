from __future__ import annotations

import json
from typing import Any

from external_api.litellm_api import (
    FunctionCall,
    LiteLLMMessage,
    TextContent,
    ToolCall,
)
from proactive_tutor.agents import tutor as tutor_module
from proactive_tutor.agents.tutor import TutorAgent
from proactive_tutor.tools import ToolDefinition, ToolProvider


def _metrics(call_id: str, tokens: int = 5) -> dict:
    return {
        "call_id": call_id,
        "operation": "tutor",
        "model": "test-model",
        "provider": "test",
        "modality": "llm",
        "prompt_tokens": tokens - 1,
        "completion_tokens": 1,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 0,
        "input_tokens": tokens - 1,
        "output_tokens": 1,
        "total_tokens": tokens,
        "duration_ms": 10.0,
        "started_at": 100.0,
        "ended_at": 100.01,
        "success": True,
        "error": None,
    }


class LookupProvider(ToolProvider):
    """A stand-in tool provider that records the queries it receives."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    def definitions(self) -> list[ToolDefinition]:
        return [
            ToolDefinition(
                name="lookup",
                description="Look up a note.",
                parameters={
                    "type": "object",
                    "properties": {"query": {"type": "string"}},
                    "required": ["query"],
                    "additionalProperties": False,
                },
                source="test_lookup",
            )
        ]

    def execute(self, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
        self.queries.append(arguments["query"])
        return {"count": 1, "results": ["The roadmap review is in Notion"]}

    def instructions(self) -> str:
        return "Use lookup only for note questions."


def _tool_response(
    name: str,
    arguments: dict,
    *,
    call_id: str = "call-1",
) -> LiteLLMMessage:
    return LiteLLMMessage(
        role="assistant",
        tool_calls=[
            ToolCall(
                id=call_id,
                function=FunctionCall(
                    name=name,
                    arguments=json.dumps(arguments),
                ),
            )
        ],
    )


def _text_response(text: str) -> LiteLLMMessage:
    return LiteLLMMessage(
        role="assistant",
        content=[TextContent(text=text)],
    )


def test_default_agent_has_no_screen_or_memory_tools() -> None:
    agent = TutorAgent("test-model", "system")

    assert agent._tool_definitions() == []
    for name in ("observe_screen", "get_user_context", "get_recent_observations"):
        assert agent._execute_tool_call({"name": name, "arguments": {}}) == {
            "error": f"tool is not available: {name}"
        }


def test_tutor_accepts_a_provider_without_agent_changes() -> None:
    class CalendarProvider(ToolProvider):
        def definitions(self) -> list[ToolDefinition]:
            return [
                ToolDefinition(
                    name="calendar_lookup",
                    description="Look up calendar events.",
                    parameters={
                        "type": "object",
                        "properties": {"date": {"type": "string"}},
                        "required": ["date"],
                        "additionalProperties": False,
                    },
                    source="test_calendar",
                )
            ]

        def execute(
            self,
            name: str,
            arguments: dict[str, Any],
        ) -> dict[str, Any]:
            return {"name": name, "events": [], **arguments}

        def instructions(self) -> str:
            return "Use calendar_lookup only for schedule questions."

    agent = TutorAgent(
        "test-model",
        "system",
        tool_provider=CalendarProvider(),
    )

    assert agent._tool_definitions()[0]["function"]["name"] == "calendar_lookup"
    assert agent._execute_tool_call(
        {"name": "calendar_lookup", "arguments": {"date": "2026-08-31"}}
    ) == {
        "name": "calendar_lookup",
        "events": [],
        "date": "2026-08-31",
    }
    assert (
        "Use calendar_lookup" in agent._prepare_initial_chat_messages([])[0]["content"]
    )


def test_tutor_executes_tool_and_synthesizes_answer(monkeypatch) -> None:
    responses = iter(
        [
            _tool_response("lookup", {"query": "roadmap"}),
            _text_response(
                "<guidance>The roadmap review appears to be your current "
                "task.</guidance>"
            ),
        ]
    )
    calls: list[list[dict]] = []

    def fake_completion(messages, **kwargs):
        calls.append([dict(message) for message in messages])
        return next(responses), _metrics(f"call-{len(calls)}")

    monkeypatch.setattr(tutor_module, "chat_completion", fake_completion)
    monkeypatch.setattr(
        tutor_module,
        "_current_datetime_context",
        lambda: "<current_datetime>2026-07-23T12:34:56-07:00</current_datetime>",
    )
    agent = TutorAgent("test-model", "base system", tool_provider=LookupProvider())

    response, metrics = agent.tutor_with_metrics("current context")

    assert response.startswith("<guidance>The roadmap")
    assert "Use lookup" in calls[0][0]["content"]
    assert "2026-07-23T12:34:56-07:00" in calls[0][0]["content"]
    assert calls[1][-1]["role"] == "tool"
    assert "roadmap review is in Notion" in calls[1][-1]["content"]
    assert metrics["total_tokens"] == 10


def test_tutor_skips_tool_loop_without_tools(monkeypatch) -> None:
    calls: list[list[dict]] = []
    completion_kwargs: list[dict] = []

    def fake_completion(messages, **kwargs):
        calls.append([dict(message) for message in messages])
        completion_kwargs.append(kwargs)
        return _text_response("final guidance"), _metrics("single-call")

    monkeypatch.setattr(tutor_module, "chat_completion", fake_completion)
    monkeypatch.setattr(
        tutor_module,
        "_current_datetime_context",
        lambda: "<current_datetime>2026-07-23T12:34:56-07:00</current_datetime>",
    )
    agent = TutorAgent("test-model", "base system")

    response, metrics = agent.tutor_with_metrics("context")

    assert response == "final guidance"
    assert len(calls) == 1
    assert completion_kwargs[0]["temperature"] is None
    assert calls[0][0]["content"] == (
        "base system\n\n<current_datetime>2026-07-23T12:34:56-07:00</current_datetime>"
    )
    assert calls[0][1] == {"role": "user", "content": "context"}
    assert metrics["call_id"] == "single-call"


def test_chat_answers_directly_without_tool_call(monkeypatch) -> None:
    def fake_chat(messages, **kwargs):
        return _text_response("Four."), _metrics("chat-direct")

    monkeypatch.setattr(tutor_module, "chat_completion", fake_chat)
    agent = TutorAgent("test-model", "base system")

    response, metrics = agent.chat_with_metrics(
        [{"role": "user", "content": "What is two plus two?"}]
    )

    assert response == "Four."
    assert metrics["tool_calls"] == []


def test_chat_tool_loop_keeps_exchange_as_separate_messages(monkeypatch) -> None:
    responses = iter(
        [
            _tool_response("lookup", {"query": "roadmap"}),
            _text_response("The roadmap review appears to be your current task."),
        ]
    )
    calls: list[list[dict]] = []

    def fake_chat(messages, **kwargs):
        calls.append([dict(message) for message in messages])
        return next(responses), _metrics(f"chat-{len(calls)}")

    monkeypatch.setattr(tutor_module, "chat_completion", fake_chat)
    monkeypatch.setattr(
        tutor_module,
        "_current_datetime_context",
        lambda: "<current_datetime>2026-07-23T12:34:56-07:00</current_datetime>",
    )
    agent = TutorAgent("test-model", "base system", tool_provider=LookupProvider())

    response, metrics = agent.chat_with_metrics(
        [{"role": "user", "content": "Where is my roadmap?"}]
    )

    assert response.startswith("The roadmap")
    assert [message["role"] for message in calls[0]] == ["system", "user"]
    assert "2026-07-23T12:34:56-07:00" in calls[0][0]["content"]
    assert [message["role"] for message in calls[1]] == [
        "system",
        "user",
        "assistant",
        "tool",
    ]
    assert "roadmap review is in Notion" in calls[1][-1]["content"]
    assert metrics["tool_calls"][0]["name"] == "lookup"
    assert metrics["tool_calls"][0]["result"]["count"] == 1


def test_chat_streams_answer_and_emits_tool_events(monkeypatch) -> None:
    responses = [
        (_tool_response("lookup", {"query": "roadmap"}), []),
        (
            _text_response("The roadmap is the current task."),
            ["The roadmap ", "is the current task."],
        ),
    ]
    call_index = 0

    def fake_chat(messages, **kwargs):
        nonlocal call_index
        response, chunks = responses[call_index]
        call_index += 1
        on_chunk = kwargs.get("on_chunk")
        if on_chunk is not None:
            for chunk in chunks:
                on_chunk(chunk)
        return response, _metrics(f"chat-{call_index}")

    monkeypatch.setattr(tutor_module, "chat_completion", fake_chat)
    events: list[dict] = []
    agent = TutorAgent("test-model", "base system", tool_provider=LookupProvider())

    response, _ = agent.chat_with_metrics(
        [{"role": "user", "content": "Where is my roadmap?"}],
        on_event=events.append,
    )

    assert response == "The roadmap is the current task."
    assert [event["type"] for event in events] == [
        "tool_call_started",
        "tool_call_completed",
        "text_delta",
        "text_delta",
    ]
    assert (
        "".join(event["text"] for event in events if event["type"] == "text_delta")
        == response
    )
    assert all("tool_call" not in event.get("text", "") for event in events)


def test_chat_allows_more_than_three_tool_calls(monkeypatch) -> None:
    tool_responses = [
        _tool_response("lookup", {"query": f"context {index}"}, call_id=f"call-{index}")
        for index in range(4)
    ]
    responses = iter(
        [*tool_responses, _text_response("Final answer after four retrievals.")]
    )
    provider = LookupProvider()

    def fake_chat(messages, **kwargs):
        return next(responses), _metrics(f"chat-{len(provider.queries)}")

    monkeypatch.setattr(tutor_module, "chat_completion", fake_chat)
    agent = TutorAgent("test-model", "base system", tool_provider=provider)

    response, metrics = agent.chat_with_metrics(
        [{"role": "user", "content": "Use all relevant context."}]
    )

    assert response == "Final answer after four retrievals."
    assert provider.queries == [f"context {index}" for index in range(4)]
    assert len(metrics["tool_calls"]) == 4
