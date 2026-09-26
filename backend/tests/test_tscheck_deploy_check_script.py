"""Backend/infra tests for deploy/check.sh, install.sh, update.sh.

These criteria are pure shell-script behavior (no HTTP API surface), so they are
verified by invoking the real scripts via subprocess rather than httpx. Tests must
never execute install.sh/update.sh (would try to install system packages / systemd
units on this pod) - only check.sh output, syntax (`bash -n`), permissions and the
presence of the symlink-creation lines inside install.sh are checked.
"""

import os
import subprocess

import pytest

DEPLOY_DIR = "/app/deploy"
CHECK_SH = os.path.join(DEPLOY_DIR, "check.sh")
INSTALL_SH = os.path.join(DEPLOY_DIR, "install.sh")
UPDATE_SH = os.path.join(DEPLOY_DIR, "update.sh")


def run(cmd, cwd=None):
    return subprocess.run(
        cmd, cwd=cwd, shell=True, capture_output=True, text=True, timeout=60
    )


@pytest.mark.parametrize("cwd", ["/root", "/tmp"])
def test_check_sh_runs_from_any_cwd_by_absolute_path(cwd):
    """Reported bug: `sudo bash deploy/check.sh` from /root -> 'No such file or directory'.
    Calling check.sh by absolute path must work from ANY cwd."""
    result = run(f"bash {CHECK_SH}", cwd=cwd)
    combined = result.stdout + result.stderr
    assert "No such file" not in combined, f"cwd={cwd} output: {combined[:500]}"
    assert "Folder: /app" in combined, f"cwd={cwd} missing Folder line: {combined[:300]}"
    assert "== Service ==" in combined or "== Servis ==" in combined, combined[:300]


def test_check_sh_via_global_symlink_resolves_app_dir():
    """/usr/local/bin/warung-check must resolve APP_DIR via readlink -f, not the
    /usr/local/bin symlink directory."""
    assert os.path.islink("/usr/local/bin/warung-check"), "warung-check symlink missing"
    result = run("warung-check", cwd="/root")
    combined = result.stdout + result.stderr
    assert "No such file" not in combined
    assert "Folder: /app" in combined, combined[:300]


@pytest.mark.parametrize("path", [CHECK_SH, INSTALL_SH, UPDATE_SH])
def test_deploy_scripts_executable_and_syntax_valid(path):
    assert os.access(path, os.X_OK), f"{path} is not executable (+x)"
    result = run(f"bash -n {path}")
    assert result.returncode == 0, f"{path} syntax error: {result.stderr}"


def test_install_sh_creates_global_symlinks():
    """install.sh (not executed here) must contain the symlink creation lines for
    the global warung-check / warung-update commands."""
    content = open(INSTALL_SH).read()
    assert "/usr/local/bin/warung-check" in content
    assert "/usr/local/bin/warung-update" in content
    assert "ln -sf" in content


def test_check_sh_reads_quoted_env_values():
    """backend/.env stores DB_NAME and WEBHOOK_CRON_SECRET with double quotes;
    check.sh must strip the quotes (envget helper) and not report them missing."""
    env_path = "/app/backend/.env"
    env_content = open(env_path).read()
    assert 'DB_NAME="' in env_content, "fixture assumption: DB_NAME is quoted in .env"
    assert 'WEBHOOK_CRON_SECRET="' in env_content

    result = run(f"bash {CHECK_SH}", cwd="/root")
    combined = result.stdout + result.stderr
    assert "DB_NAME kosong" not in combined, combined[:800]
    assert "WEBHOOK_CRON_SECRET kosong" not in combined, combined[:800]
