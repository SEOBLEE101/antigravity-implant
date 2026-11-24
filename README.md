# Antigravity Implant

**English** | [한국어](README.ko.md)

**Make Google Antigravity feel like Claude Code and Codex.** An Antigravity plugin that turns a silent tool-calling agent into one that narrates its work, answers your questions first, shows visual evidence mid-task, verifies before stopping, and connects sessions across machines. Nothing in the app is patched — you just drop one plugin folder in.

> Agent-facing texts (hook reminders, skills, built-in rules) are written in Korean, the author's working language. Antigravity models follow them well in any language; you can also add auto-translated reply-formatting rules to `GEMINI.md` during install with `-ReadableReplies`, or translate `rules/AGENTS.md` and the skills if you prefer full English prompts.

## Who is this for

- You want the agent to tell you what it is doing in the chat instead of thinking privately while firing silent tool calls.
- You edit `GEMINI.md` mid-task and want changes picked up immediately instead of waiting for the turn to end.
- You miss Claude Code and Codex workflows such as `/code-review`, `/rewind`, live checklists, clear wrap-ups, and multi-session coordination.

## What changes

| Pain point | Antigravity Implant |
|---|---|
| Works silently | Writes a progress line (`NN% …`) plus one sentence before each tool call |
| No mid-task evidence | Reminds the agent to show screenshots right after capture; collects captures live in the side panel |
| Rule edits mid-task are ignored | Injects your edits to `GEMINI.md` / `AGENTS.md` on the very next model call |
| Ignores you while busy | Responds to mid-task messages first; send messages or ⏸ pause directly from the panel |
| Claims "done" without verifying | Prompts once to wrap up properly if files changed without any verification noted |
| Hard-to-read walls of text | Opt-in `-ReadableReplies` adds 10 formatting rules to `GEMINI.md`, auto-translated to your settings or locale |
| No undo for bad edits | Automatic git checkpoint on every message, plus `/rewind` or panel buttons to restore and undo |
| Runs dangerous commands | Always blocks drive wipes and formatting; gates force-push, `reset --hard`, and registry edits behind explicit requests |
| Misses syntax errors | Checks `.js`, `.mjs`, `.cjs`, `.json`, and `.py` syntax right after edits and reports errors on the next call |
| Prompts for every file outside the workspace | Remembers the folder of files you allow so you are not asked again |
| Auto mode still prompts for commands | Opt-in: remembers writable folders from approved unsandboxed commands so later runs stay inside the sandbox |
| Sessions are isolated | Session Mesh exchanges notes across local sessions and remote machines (Tailscale/LAN, shared folder, or cloud relay) |
| Panel looks out of place | Live Cockpit mirrors the app's theme live, or lets you pick from 9 themes, custom accents, and a Gemini 4 periodic-table model explorer |

## What's inside

| Component | Details |
|---|---|
| **Hooks** | Progress narration, mid-task message priority, live rule reload, loop/stuck detection, context warnings (85k/105k), wrap-up & early-stop checks, dangerous-command guard, post-edit syntax check, folder-level permission memory, automatic git checkpoints, session-mesh inbox delivery |
| **14 skills** | `/plan-first` `/code-review` `/rewind` `/remember` `/init-project` `/handoff` `/commit` `/pr` `/worktree` `/doctor` `/status-report` `/computer-use` `/session-mesh` `evidence-checkpoint` |
| **Live Cockpit panel** | 9 tabs: Periodic Table (Google AI Studio style model explorer), Progress, Plan (`task.md`), Evidence, Diff, Rewind, Live Rules, Hook Log, and Session Mesh — plus token chip, mode presets, live app-theme sync, message box, and ⏸ pause |
| **Session Mesh (MCP + CLI)** | Built-in `session-bridge` MCP server (`mesh_status`, `mesh_list_sessions`, `mesh_send`, `mesh_inbox`, `mesh_sync_now`), CLI & daemon (`cli/mesh.mjs`, `cli/mesh-daemon.mjs`), and self-hostable relay templates (`relay/cloudflare-worker`, `relay/node-relay`) |
| **CLI tools** | Status line (`statusline.mjs`), checkpoint rewind (`rewind.mjs`), health check (`doctor.mjs`), and session mesh (`mesh.mjs`, `mesh-daemon.mjs`) |

Full reference (configuration, checkpoints, guard rules, session mesh, limitations — Korean): [antigravity-implant/README.md](antigravity-implant/README.md)

## Install (Windows)

Requirements: [Antigravity](https://antigravity.google), Node.js 18+, and git (for checkpoints).

```powershell
git clone https://github.com/SEOBLEE101/antigravity-implant.git
cd antigravity-implant
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine
```

Optional flags:

```powershell
# Also add 10 "Readable Replies" formatting rules to ~/.gemini/GEMINI.md, auto-translated to your settings/locale
powershell -ExecutionPolicy Bypass -File .\install.ps1 -StatusLine -ReadableReplies

# Pin a specific language (built-in: ko, en, ja, zh-CN, zh-TW, es, fr, de, pt)
powershell -ExecutionPolicy Bypass -File .\install.ps1 -ReadableReplies -Lang en
```

- Restart Antigravity, then open the panel from the right-hand pane of a conversation: **`+` → Extensions → Live Cockpit** (once per conversation). On first run, verify under **Customizations → antigravity-implant → UI extensions → Live Cockpit** that it says Running.
- Health check: run `/doctor` in a new conversation.
- Uninstall: `powershell -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall` (keeps your data folder; cleanly removes the status line entry and any marker block added to `GEMINI.md`).

`install.ps1` stages and validates the plugin in a temporary folder before placing it in `%USERPROFILE%\.gemini\config\plugins\`. It never touches admin rights, the Windows registry, permission allow-lists, or the network. `-StatusLine` backs up the `agy` CLI settings before adding one status-line entry.

### Readable Replies (`-ReadableReplies`)

When enabled, the installer backs up `~/.gemini/GEMINI.md` to a `.bak` file and manages only its own HTML marker block (`<!-- antigravity-implant:readable-replies:start ... -->`). Existing user rules stay untouched, and if you already wrote a manual section with the same heading, it skips without duplicating.

Language resolution order:

1. Explicit `-Lang` flag
2. `language` / `locale` in `~/.gemini/antigravity-implant/config.json`
3. Language settings in Antigravity's `config.json`
4. Language detected from existing `GEMINI.md` prose or explicit reply-language instructions
5. `ANTIGRAVITY_LANG`, Windows display locale, `LC_ALL` / `LANG`
6. English (`en`) fallback

Built-in translations cover 9 languages (`ko`, `en`, `ja`, `zh-CN`, `zh-TW`, `es`, `fr`, `de`, `pt`). Other valid BCP-47 locales fall back to the English rules plus a top-line instruction to reply in that locale.

### Session Mesh (cross-session & multi-machine messaging)

Talk across Antigravity conversations on the same PC or between separate Windows and Mac machines using the `/session-mesh` skill, the Live Cockpit **Session** tab, or the CLI.

- **Local**: works out of the box between conversations on the same machine (`toMachine: "local"`).
- **Remote transports** (auto-fallback order `http → relay → folder`):
  - **Tailscale / LAN HTTP**: fastest real-time delivery and live session listing when both machines are online.
  - **Cloud relay**: self-hosted Cloudflare Worker (`relay/cloudflare-worker`) or Node relay (`relay/node-relay`) with a 7-day offline queue. See [antigravity-implant/relay/README.md](antigravity-implant/relay/README.md).
  - **Shared folder**: sync through Google Drive or any synced folder with no daemon required.
- **Quick pairing**: run `node cli/mesh.mjs init --name win-main --tailscale` (or `--folder` / `--relay`), export a token with `pair-export`, and import it on the other machine with `pair-import`.

### Optional: desktop app control (computer use)

Installs the open-source [sandraschi/windows-computer-use-mcp](https://github.com/sandraschi/windows-computer-use-mcp) (MIT) at a pinned commit. Not included in the default install.

```powershell
powershell -ExecutionPolicy Bypass -File .\install-computer-use.ps1
```

It asks for confirmation, backs up `mcp_config.json`, and registers one server with keylogging, face detection, trajectory logging, and clipboard reading disabled. Requires git and [uv](https://docs.astral.sh/uv/).

## Fewer permission prompts in Auto mode

**Why Auto mode still asks:** terminal commands run in a sandbox that can only write to your workspace and explicitly allowed folders. When a command needs another path, the agent requests an unsandboxed run (`BypassSandbox`), and Antigravity saves that approval as an exact full-command rule that rarely matches again.

**Opt-in folder learning:** setting `"folderGrantsFromCommands": true` in `~/.gemini/antigravity-implant/config.json` lets the plugin record `write_file(<folder>\)` for existing folders named in an approved unsandboxed command (up to 3 per command), so future work in those folders stays inside the sandbox. It is off by default because a command string alone cannot prove where the command wrote. Paths reached through junctions, symlinks, or 8.3 short names are never widened, nor are drive roots, your home folder and its immediate children, `AppData`, dot-folders, system folders, executable directories, or unusual path spellings (`~1`, `:` streams, `\\?\`, trailing dots/spaces). Recorded folders live in `~/.gemini/antigravity-implant/folder-grants.json`.

**What it cannot change:** tools missing inside the sandbox (such as an external browser CLI) always need `BypassSandbox`. To turn off prompts completely, choose **Settings → General → Permissions → This Computer → Turbo** yourself — a real security trade-off the plugin never modifies on your behalf.

## Themes and colors

- **Antigravity app:** **Settings → Appearance** offers 11 presets (Catppuccin, Dracula, Tokyo Night, Gruvbox Material, One Dark Pro, Solarized Dark, and more) plus custom Background, Foreground, Accent, Contrast, Font, and Font Size. Edit them inside the app rather than in `~/.gemini/config/config.json`, since the running app does not reload external edits.
- **Live Cockpit panel:** use the **Color** menu at the top. *Follow app* (default) syncs with the app's theme automatically, or pick from 9 panel themes (Catppuccin, Dracula, Tokyo Night, Gruvbox, Nord, Solarized Dark, One Dark, GitHub Light, Paper) with an independent accent swatch. Selecting a panel theme also displays copyable hex values to match the app's Appearance settings.

## Safety

- **Dangerous-command guard:** hooks `run_command` only and never returns `allow`, leaving your own permission settings in control. Inspects nested commands inside `cmd /c`, `powershell -c`, script blocks, and `-EncodedCommand`.
- **Safe checkpoints:** never touches your working tree, index, or branches; skips secret-looking and large files; disables repository-defined git filters, signing, and hooks; enforces memory and time caps.
- **Locked-down panel & mesh:** Live Cockpit binds to `127.0.0.1` only, requires a token for write requests, and rejects non-local Host headers. Session Mesh marks peer messages as untrusted notes that never override system rules or user instructions, caps forwarding hops (default 4), and defaults HTTP binding to loopback or Tailscale private IPs.
- **Tamper-resistant live rules:** live rule edits made while the agent was running commands or tools are ignored.
- **Independent reviews:** audited twice end-to-end by another model (Gemini Carbon orchestrator swarm) and three times by automated security review, with all findings resolved.

## Tests

```powershell
node tests/run-all.mjs
```

273 checks across 8 suites. Every test runs against a temporary fake home directory, so your real `~/.gemini` is never touched. `cockpit-rewind-test` requires the `sidecar_sdk` installed by the Antigravity app and is skipped if absent.

## Why it is built this way (verified by experiment)

- All six Antigravity hook events (`SessionStart`, `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, `Stop`) fire reliably, taking roughly 0.1 s each.
- In `PreInvocation`, `ephemeralMessage` applies only to the current call while `systemMessage` persists in the conversation — so per-call nudges use ephemeral messages and lasting updates (rule edits, rewind notices, mesh inbox) use `systemMessage`.
- `PreToolUse` fails closed (empty output, errors, or invalid JSON all block the tool) and `allow` bypasses user permissions — so the guard hooks `run_command` only and defaults to `ask`.
- `PostToolUse` ignores `injectSteps` — so syntax-check results are handed off through a state file and surfaced by the next `PreInvocation`.
- `Stop` supports `decision: "continue"` and marks the second stop with `continuationActive` — ensuring wrap-up checks run at most once per turn.
- Without nudges, Gemini Flash almost always fires tool calls with no visible text; with the reminder, it explains its step first every time.

## Limitations

- Tested on Windows only (Antigravity app 2.31, `agy` CLI 1.5.8).
- Mid-task messages and pause apply on the next model call and never interrupt a running tool.
- Hooks can remind the model to display a screenshot it took, but cannot force it to capture one. Any captures taken still appear automatically in the panel's Evidence tab.
- The Live Cockpit panel must be opened once per conversation from the right-hand pane's `+` menu.

## License

MIT. Live Cockpit uses the `sidecar_sdk` distributed with the Antigravity app; it is not bundled in this repository. Antigravity is a trademark of Google, and this project is not affiliated with Google.
