"""Lightweight dispatcher for the frozen tutor service executable."""

import sys


def main() -> None:
    """Run a utility mode or the normal tutor HTTP server."""
    if sys.argv[1:] == ["--dependency-smoke-test"]:
        from external_api.dependency_smoke import main as smoke_main

        smoke_main()
        return

    if sys.argv[1:2] == ["--test-model-connection"]:
        from proactive_tutor.model_connection_test import main as test_model_main

        test_model_main(sys.argv[2:])
        return

    import chz
    from proactive_tutor.tutor_server import main as tutor_main

    chz.entrypoint(tutor_main, allow_hyphens=True)


if __name__ == "__main__":
    main()
