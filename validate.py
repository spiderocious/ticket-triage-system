#!/usr/bin/env python3
"""Validation entry point.

The pipeline is TypeScript, so the real validator lives in `src/validate.ts`. This shim exists because
`python validate.py` is the command the brief names; it forwards every argument and exit code unchanged.

Equivalent, and faster if you already have Node on PATH:

    npm run validate
    make validate
"""
import shutil
import subprocess
import sys


def main() -> int:
    if shutil.which("npx") is None:
        sys.stderr.write(
            "Node.js is required. Install Node 20+, run `npm ci`, then either\n"
            "  python validate.py\n"
            "  npm run validate\n"
        )
        return 1
    completed = subprocess.run(
        ["npx", "tsx", "src/validate.ts", *sys.argv[1:]],
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
