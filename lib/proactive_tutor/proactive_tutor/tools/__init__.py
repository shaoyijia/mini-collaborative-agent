"""Composable tool providers for the tutor agent."""

from proactive_tutor.tools.apple_calendar import AppleCalendarProvider
from proactive_tutor.tools.base import (
    CompositeToolProvider,
    ToolDefinition,
    ToolProvider,
)
from proactive_tutor.tools.factory import build_tutor_tool_provider
from proactive_tutor.tools.mcp import MCPServerConfig, MCPToolProvider

__all__ = [
    "AppleCalendarProvider",
    "CompositeToolProvider",
    "MCPServerConfig",
    "MCPToolProvider",
    "ToolDefinition",
    "ToolProvider",
    "build_tutor_tool_provider",
]
