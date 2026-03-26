# Agents & Workflows

## `/prime` — Interpreter-Executor Subagent

Spawns a subagent with the `default-prime.md` BRIEF→EXECUTE framework. Useful for any task that benefits from structured reasoning before execution.

```
/prime <task description>
```

The subagent runs with opus model, has full codebase access, and returns output to the caller. Uses two-stage protocol: first presents a structured BRIEF (role, objective, approach, output format), then EXECUTEs directly.

Agent definition: `.claude/agents/default-prime.md`

---

## Simple Fix Loop

A reusable workflow for diagnosing and fixing prompt/config issues in the banner-bot. Demonstrated on the gate prompt fix (2026-03-26).

### The Loop

```
1. REPRODUCE    → Run eval harness to capture baseline behavior
2. DIAGNOSE     → Analyze why the prompt/config fails (multi-run stats)
3. FIX          → One-shot change to the source (src/config.ts)
4. VERIFY LOCAL → Re-run eval to confirm fix works
5. DEPLOY       → git push origin main (triggers CI → systemd restart, ~20s)
6. CONFIRM PROD → Re-run eval to validate prod behavior matches
7. CLEANUP      → Stop all background tasks/shells spawned during the session
```

### Cleanup (mandatory)

After every session, stop all background tasks you spawned. SSH sessions to exe.dev stay open indefinitely if not killed — always clean up.

```bash
# List running background tasks and stop each one
# Use TaskStop for each task ID from background SSH/bash commands
```

This is not optional. Leave no orphaned shells or SSH connections behind.

### Commands

```bash
# Run gate eval (default 10 runs per message, haiku model)
source ~/.zshrc && node eval/run-gate-eval.mjs [runs] [model]

# Check deploy status
gh run list --limit 1
gh run watch <run-id> --exit-status

# View deploy logs
gh run view <run-id> --log
```

### Eval Harness Convention

- Test messages live in `eval/*.txt`
- Files with `not-funnel` in the name are expected to be REJECTED
- All other `.txt` files (except `gate-prompt.txt`) are expected to PASS
- The harness reads the prompt directly from `src/config.ts` (single source of truth)
- Exit code 0 = all correct, 1 = failures detected

### Deployment

- **Trigger**: push to `main` branch
- **CI**: GitHub Actions on self-hosted runner (`.github/workflows/ci.yml`)
- **Flow**: checkout → npm ci → tsc build → copy to `/opt/banner-bot/` → systemd restart
- **Time**: ~20 seconds end-to-end
- **Secrets**: managed in GitHub repo settings (BOT_TOKEN, API_ID, API_HASH, DEV_TG_ID, OPENROUTER_API_KEY)

### Accessing the Production Instance (exe.dev)

The bot runs on `banner-bot.exe.xyz` via [exe.dev](https://exe.dev). Access is SSH-based.

```bash
# First-time setup (interactive — accept host key, login)
! ssh exe.dev

# List VMs
ssh exe.dev ls

# SSH into the banner-bot VM (run commands via heredoc)
ssh exe.dev ssh banner-bot <<'CMD'
systemctl status banner-bot
CMD

# Inspect deployed code
ssh exe.dev ssh banner-bot <<'CMD'
grep -A5 "haikusSystemPrompt" /opt/banner-bot/dist/config.js | head -10
CMD

# View live logs
ssh exe.dev ssh banner-bot <<'CMD'
journalctl -u banner-bot -f --no-pager -n 50
CMD

# Restart the service (if needed outside CI)
ssh exe.dev ssh banner-bot <<'CMD'
sudo systemctl restart banner-bot
CMD
```

Key paths on the VM:
- `/opt/banner-bot/` — deployed app (dist/, node_modules/, package.json)
- `/opt/banner-bot/.env` — secrets (chmod 600, root-only)
- `/etc/systemd/system/banner-bot.service` — systemd unit

### Adding Test Cases

To add a new eval case, create a `.txt` file in `eval/`:

```bash
# Message that SHOULD pass the gate
echo "Your funnel message text" > eval/eval-my-test.txt

# Message that SHOULD be rejected
echo "Some non-funnel text" > eval/eval-not-funnel-my-test.txt
```

Then run `node eval/run-gate-eval.mjs` to verify.
