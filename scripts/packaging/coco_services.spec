# -*- mode: python ; coding: utf-8 -*-
"""Build Coco's Python services into one shared onedir bundle."""

import platform
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs, copy_metadata


ROOT = Path(SPEC).resolve().parents[2]

TUTOR_ENTRY = (
    ROOT / "lib" / "proactive_tutor" / "proactive_tutor" / "packaged_entrypoint.py"
)
WAKE_WORD_ENTRY = (
    ROOT / "lib" / "proactive_tutor" / "proactive_tutor" / "wake_word_worker.py"
)

COMMON_HIDDEN_IMPORTS = [
    # uvicorn internals
    "uvicorn.logging",
    "uvicorn.loops",
    "uvicorn.loops.auto",
    "uvicorn.protocols",
    "uvicorn.protocols.http",
    "uvicorn.protocols.http.auto",
    "uvicorn.protocols.websockets",
    "uvicorn.protocols.websockets.auto",
    "uvicorn.lifespan",
    "uvicorn.lifespan.on",
    # starlette internals used by fastapi
    "starlette.responses",
    "starlette.routing",
    "starlette.middleware",
    "starlette.middleware.cors",
    # LLM / tokenizers
    "tiktoken",
    "tiktoken_ext",
    "tiktoken_ext.openai_public",
    # shared workspace packages
    "external_api",
    "py_utils",
]

TUTOR_HIDDEN_IMPORTS = COMMON_HIDDEN_IMPORTS + [
    "proactive_tutor",
]

if platform.system() == "Darwin":
    TUTOR_HIDDEN_IMPORTS += ["EventKit", "Foundation", "objc"]

WAKE_WORD_HIDDEN_IMPORTS = [
    "numpy",
    "sherpa_onnx",
    "sherpa_onnx.lib._sherpa_onnx",
]

tutor_datas = collect_data_files("proactive_tutor")
tutor_datas += collect_data_files("litellm")
# Report the exact SDK versions from the packaged dependency smoke check.
tutor_datas += copy_metadata("litellm")
tutor_datas += copy_metadata("mcp")

wake_word_datas = collect_data_files("sherpa_onnx")

tutor = Analysis(
    [str(TUTOR_ENTRY)],
    pathex=[str(ROOT)],
    binaries=[],
    datas=tutor_datas,
    hiddenimports=TUTOR_HIDDEN_IMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    noarchive=False,
    optimize=0,
)

wake_word = Analysis(
    [str(WAKE_WORD_ENTRY)],
    pathex=[str(ROOT)],
    binaries=collect_dynamic_libs("sherpa_onnx"),
    datas=wake_word_datas,
    hiddenimports=WAKE_WORD_HIDDEN_IMPORTS,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["pandas"],
    noarchive=False,
    optimize=0,
)

tutor_pyz = PYZ(tutor.pure)
wake_word_pyz = PYZ(wake_word.pure)

tutor_exe = EXE(
    tutor_pyz,
    tutor.scripts,
    [],
    exclude_binaries=True,
    name="tutor-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

wake_word_exe = EXE(
    wake_word_pyz,
    wake_word.scripts,
    [],
    exclude_binaries=True,
    name="wake-word-worker",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

# A single COLLECT gives both executables one shared _internal directory. Files
# with the same destination (Python, NumPy, and so on) are
# collected only once.
bundle = COLLECT(
    tutor_exe,
    wake_word_exe,
    tutor.binaries,
    tutor.datas,
    wake_word.binaries,
    wake_word.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="coco-services",
)
