# Connect an AI

Ask questions about the SAP export in plain English, such as "What is at risk this week?". Both options answer from the same numbers as the dashboard pages, as of the export date. The dashboard's **Connect an AI** page (sidebar, under **Help**) has the short version with a Copy button.

## Option 1: Ask AI in this dashboard

Nothing to install. On the hosted site, click **Ask AI** at the top of any page, pick a provider in **Settings** and tick its consent box. Claude and ChatGPT are paid and do not train on what you send; Groq and OpenRouter's free models cost nothing but may keep what you send. A shared snapshot or a copy opened as a file cannot use Ask AI. Details: [AI_ASSISTANT.md](AI_ASSISTANT.md).

## Option 2: Your own AI app (MCP connector)

The connector `mcp/spyder-kpi-mcp.mjs` is a small program that runs on your computer and reads the export files you list. It needs only Node.js.

1. Install Node.js 20 or newer from [nodejs.org](https://nodejs.org).
2. Save the dashboard folder on your computer (IT has it). It needs `index.html` and the `mcp` folder.
3. Add the connector to your AI app, as below.

### Claude Desktop

Open **Settings → Developer → Edit Config** (this opens `claude_desktop_config.json`: on Windows `%APPDATA%\Claude\claude_desktop_config.json`, on macOS `~/Library/Application Support/Claude/claude_desktop_config.json`). Add this with your two paths, save, then restart Claude:

```json
{
  "mcpServers": {
    "spyder-kpi": {
      "command": "node",
      "args": [
        "C:\\path\\to\\spyder-kpi-dashboard\\mcp\\spyder-kpi-mcp.mjs",
        "C:\\path\\to\\kpi_export.xls"
      ]
    }
  }
}
```

- In JSON every `\` in a Windows path is written twice (`\\`).
- If the file already has settings, keep them: put the `"spyder-kpi"` entry inside its `"mcpServers"` section, or add `"mcpServers"` after the last setting with a comma. The file must stay one `{ ... }` block.
- To also load a supply / demand snapshot or a Clear To Build report, add its path to `args` after the KPI export.

### Claude Code

Run this once with your two paths, in the folder where you use Claude Code (add `--scope user` after `add` to use it in every folder):

```
claude mcp add spyder-kpi -- node "C:\path\to\spyder-kpi-dashboard\mcp\spyder-kpi-mcp.mjs" "C:\path\to\kpi_export.xls"
```

Then start `claude` there and type `/mcp` to check that spyder-kpi is connected.

### Any other MCP app

Cursor, VS Code, ChatGPT desktop and other apps that support local MCP servers:

| Setting | Value |
| --- | --- |
| Transport | stdio (a local command) |
| Command | `node` |
| Arguments | The full path of `mcp\spyder-kpi-mcp.mjs`, then the full path of each export file |

Instead of listing files in the arguments, you can set `SPYDER_KPI_FILES` to the paths, separated by `;`.

## Example questions

- What is at risk right now, and why?
- How much of the at-risk value is waiting on us, and what are the top reasons?
- Which customers have the most past due value?
- Show the late purchase orders by vendor.
- Which orders are due next week in the CM warehouses?
- How was on-time delivery over the last 3 months?
- Load C:\Exports\kpi_export.xls and give me the overview. (Option 2 only)

## What the AI can look up

| Tool | What it returns |
| --- | --- |
| `get_overview` | Every Order Health and Purchase Orders tile, the as-of date and the data check. `order_health.leading` adds at-risk value by cause (`us` = Spyder, `them` = customer or carrier, `neutral`, `not_set`), the open order states, the top 6 at-risk reasons and when flagged (weeks since first at risk); `order_health.lagging` adds each lagging rate with the cause of its misses, fill rate by month, perfect order 12 mo and average days late 3 mo |
| `search_lines` | Order lines by scope (at risk, no commit, rescheduled, due this week, open, late POs, ...), words and cause (`us`, `them`, `neutral`, `not_set`). Sales order lines with a risk signal carry their cause, reasons and first flagged date |
| `group_totals` | Lines, orders and open value by warehouse, customer, owner, vendor, due month or status |
| `get_monthly` | The Monthly page: shipped and open value by month |
| `get_build_risk` | The Build Risk page (needs a Clear To Build report) |
| `get_supply_demand` | The Supply / Demand page (needs a supply / demand snapshot) |
| `load_exports` | Loads other export files, replacing what is loaded |
| `loaded_files` | What is loaded: files, kind, rows and the as-of date |

The tools only read; nothing changes in SAP or the export files. The connector does not see notes, overrides, causes or the at-risk history saved in the dashboard, so it decides each cause from the override status in the file and the SAP dates, and counts every at-risk line as new this week. The cause rules are in the dashboard under Order Health → About these numbers.

## Update the export

Save the new export over the old file (same path), then ask the AI to load it ("Load C:\Exports\kpi_export.xls", which calls `load_exports`) or restart the AI app (Claude Desktop: quit it from the tray or menu bar, not just the window). If the file name changed, change the path in the config too.

## Privacy

- The connector runs on your computer and reads only the files you list (`.xlsx`, `.xls`, `.csv`, `.txt` or `.tsv`).
- The AI app receives the tool answers (order lines, customers, vendors, values and dates) and sends them to its provider.
- Use only an AI app Spyder Controls approves for this data.

## Troubleshooting

**Check that it runs.** In a terminal, from the dashboard folder:

```
node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"
```

It loads the file, prints the overview (the same numbers as Order Health and Purchase Orders) and exits. If the file cannot be read, it prints why and exits with code 1.

**"node" is not recognized / command not found.** Install Node.js 20 or newer from [nodejs.org](https://nodejs.org), then restart the AI app (or the computer); `node --version` in a new terminal should print v20 or newer. If the app still cannot find it, use the full path as the command, for example `"command": "C:\\Program Files\\nodejs\\node.exe"`. On a Mac, Claude Desktop does not see the Terminal's PATH (for example with nvm or Homebrew): run `which node` and use the path it prints, such as `/opt/homebrew/bin/node`.

**Paths with spaces.** In the Claude Desktop config each path is its own quoted string, so spaces are fine. In a terminal command (Claude Code, `--check`), put each path in double quotes. Use full paths.

**The AI says no export is loaded.** The path is wrong or the file moved. Ask the AI to call `loaded_files` (it shows what is loaded and the last load error), or to load the file by its full path.

**Claude Desktop shows the server as failed.** Open **Settings → Developer** for the error; in Claude's MCP log, lines starting with `[spyder-kpi]` come from the connector. Common causes: a JSON typo (a missing comma or a single `\` in a path), or `index.html` is not in the folder above `mcp`. If it is elsewhere, add `"--index", "C:\\path\\to\\index.html"` before the export paths in `args`.

**The numbers differ from the website.** Check the as-of date (`loaded_files`). The connector reads the file you listed, which may be older than the one in the browser.
