# Antigravity Implant

**English** | [한국어](README.ko.md)

**Make Google Antigravity work like Claude Code and Codex.** An Antigravity plugin that turns an agent which silently fires tool calls into one that talks while it works, answers your questions first, shows evidence mid-task, and tells you what it verified before it stops. It does not patch the app — you just drop one plugin folder in.

> The agent-facing texts (hook reminders, skills, rules) are written in Korean, the author's working language. Antigravity models follow them fine; translate `rules/AGENTS.md` and the skills if you prefer English output.

## Who is this for

- You are tired of the Antigravity agent "thinking" in private while the screen only shows a stream of tool calls.
- You edited `GEMINI.md` mid-task and it was ignored until the turn ended.
- You are used to Claude Code / Codex features like `/review`, `/rewind`, todo lists and progress updates.

## What changes

| Pain point | Antigravity Implant |
|---|---|
| Works silently | Before each tool call: a progress line (`NN% …`) plus one sentence on what it is about to do |
| No evidence mid-task | After a screenshot it is told to show it; the side panel collects captures in real time |
| Rule edits mid-task are ignored | Your edits to `GEMINI.md` / `AGENTS.md` are injected on the very next model call |
| Ignores you while busy | Replies to mid-task messages first; send messages or ⏸ pause from the panel |
| Says "done" without checking | If files changed but the final answer says nothing about verification, it is asked once to wrap up properly |
| No undo | Automatic git checkpoint on every message → `/rewind` or a panel button to restore / undo |
| Runs dangerous commands | Wiping a drive, formatting, etc. are always blocked; force-push, `reset --hard`, registry edits only pass when you asked for them |
| Misses syntax errors | `.js/.json/.py` files are syntax-checked right after an edit; errors are reported on the next call |
| Asks permission for every file outside the workspace | Once you allow a file, its folder is remembered so you are not asked again |

## What's inside

| | |
|---|---|
| **Hooks** | progress reporting · mid-task messages first · live rule reload · loop / stuck detection · context warnings · wrap-up check · early-stop detection · dangerous-command guard · post-edit syntax check · folder-level permission memory · automatic checkpoints |
| **13 skills** | `/plan-first` `/code-review` `/rewind` `/remember` `/init-project` `/handoff` `/commit` `/pr` `/worktree` `/doctor` `/status-report` `/computer-use` `evidence-checkpoint` |
| **Live Cockpit panel** | progress · plan (task.md) · screenshots · git diff · rewind · live rules · hook log · tokens · mode · send message · ⏸ pause |
| **CLI** | status line, rewind, doctor |

Full reference (settings, checkpoints, guard rules, limits) — Korean: [antigravity-implant/README.md](antigravity-implant/README.md)

## Install (Windows)

Requirements: [Antigravity](https://antigravity.google), node 18+, git (for checkpoints).

```powershell
git clone https://github.com/SEOBLEE101/antigravity-implant.git
cd antigravity-implant
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine
```

- Restart the app, then open the panel from the right-hand pane of a conversation: **`+` → Extensions → Live Cockpit** (once per conversation). The first time, check under **Customizations → antigravity-implant → UI extensions → Live Cockpit** that it says Running.
- Health check: `/doctor` in a new conversation
- Uninstall: `install.ps1 -Uninstall` (your data folder is kept)

`install.ps1` validates the plugin in a temporary folder and then places it in `%USERPROFILE%\.gemini\config\plugins\`. It does not touch admin rights, the registry, permission allow-lists or the network. `-StatusLine` backs up the agy CLI settings and adds a single status-line entry.

### Optional: desktop app control (computer use)

Installs the open-source [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) (MIT) at a pinned commit. Not part of the default install.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-computer-use.ps1
```

It asks for confirmation, backs up `mcp_config.json`, and registers one server with keylogging, face detection, trajectory logging and clipboard reading turned off. Requires git and [uv](https://docs.astral.sh/uv/).

## Safety

- The dangerous-command guard only hooks `run_command` and never returns `allow` (your permission settings stay in charge). It also unpacks commands hidden inside `cmd /c "…"`, `powershell -c "…"` and `-EncodedCommand`.
- Checkpoints never touch your working tree, index or branches, skip secret-looking and large files, and never run filter / signing / hook programs from the repository's own config. Memory and time limits apply.
- The panel binds to `127.0.0.1` only, requires a token for write requests, and rejects requests with any other host name.
- Live rules changed while the agent was running commands are ignored (a command could have written them).
- Reviewed twice end-to-end by another model (Gemini Carbon orchestrator swarm) and three times by an automated security review; all findings were fixed.

## Tests

```powershell
node tests/run-all.mjs
```

162 checks. Each run uses a temporary fake home folder, so your real `~/.gemini` is never touched. `cockpit-rewind-test` needs the `sidecar_sdk` that the Antigravity app installs and is skipped otherwise.

## Why it is built this way (verified by experiment)

- All six Antigravity hook events (`SessionStart` `PreInvocation` `PreToolUse` `PostToolUse` `PostInvocation` `Stop`) really fire; one hook run takes about 0.1 s.
- In `PreInvocation`, `ephemeralMessage` lasts for that call only while `systemMessage` stays in the conversation → per-call reminders are ephemeral; only things that must persist (rule changes) use systemMessage.
- `PreToolUse` fails closed (empty output, errors, broken JSON all block the tool), and `allow` bypasses the user's permission settings → the guard hooks `run_command` only and defaults to `ask`.
- `PostToolUse` `injectSteps` is ignored → syntax-check results are handed over through a file and reported by the next `PreInvocation`.
- `Stop` with `decision: "continue"` works and the second stop carries `continuationActive` → the wrap-up check runs at most once per turn.
- Without any rules, Gemini Flash almost always calls tools with no visible text; with the reminder it explains first every time.

## Limitations

- Tested on Windows only (Antigravity app 2.31, agy CLI 1.5.8).
- Mid-task messages and pause never interrupt a running tool; they apply on the next model call.
- Hooks can tell the model to show a screenshot it took, but cannot force it to take one. Captures that do exist always appear in the panel's Evidence tab.
- The panel has to be opened once per conversation from the right-hand pane's `+` menu.

## License

MIT. The panel uses the `sidecar_sdk` that Google ships with the Antigravity app; it is not included in this repository (the installed copy is used). Antigravity is a trademark of Google; this project is not affiliated with Google.
