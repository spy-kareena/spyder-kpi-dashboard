# Connect an AI

You can ask questions about the SAP export in plain English, such as "What is at risk this week?". Every option below answers from the same numbers the dashboard pages show, as of the export date.

The dashboard has the same steps on its **Connect an AI** page (sidebar, under **Help**). That page has Copy buttons for the snippets.

## Option 1: Ask AI in this dashboard (Google Gemini)

There is nothing to install. Click **Ask AI** at the top of any page, tick the consent box and, if it asks for one, paste a free Google AI Studio key (a hosted site may have a key set up already). Your question and the numbers needed to answer it go from your browser to Google. See [AI_ASSISTANT.md](AI_ASSISTANT.md).

## Option 2: Claude Desktop

The connector is a small program in the `mcp` folder (`mcp/spyder-kpi-mcp.mjs`). It runs on your computer and reads the export files you list. It needs nothing but Node.js.

1. Install Node.js 18 or newer from [nodejs.org](https://nodejs.org).
2. Save the dashboard folder on this computer. Ask IT for it if you only use the website. It needs `index.html` and the `mcp` folder.
3. In Claude Desktop, open **Settings → Developer → Edit Config**. This opens `claude_desktop_config.json`:
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

   Add the lines below with your two paths, save, then restart Claude.

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

- In JSON, every `\` in a Windows path is written twice (`\\`).
- If the file already has settings, keep them: put the `"spyder-kpi"` entry inside its `"mcpServers"` section, or add the `"mcpServers"` part after the last setting, separated by a comma. The whole file must stay one `{ ... }` block.
- To also load a supply / demand snapshot or a Clear To Build report, add its path to `args` after the KPI export.

## Option 3: Claude Code

Run this once in a terminal, with your two paths, in the folder where you use Claude Code:

```
claude mcp add spyder-kpi -- node "C:\path\to\spyder-kpi-dashboard\mcp\spyder-kpi-mcp.mjs" "C:\path\to\kpi_export.xls"
```

Then start `claude` in that folder and type `/mcp` to check that spyder-kpi is connected. `claude mcp add` adds the server for the current folder only; to use it in every folder, add `--scope user` after `add` (`claude mcp add --scope user spyder-kpi -- node ...`).

## Option 4: Any other MCP app

Cursor, VS Code, ChatGPT desktop and other apps that support local MCP servers. Add a server with these settings:

| Setting | Value |
| --- | --- |
| Transport | stdio (a local command) |
| Command | `node` |
| Arguments | The full path of `mcp\spyder-kpi-mcp.mjs`, then the full path of each export file |

Instead of listing files in the arguments, you can set the environment variable `SPYDER_KPI_FILES` to the paths, separated by `;`.

## Example questions

- What is at risk right now, and why?
- How much of the at-risk value is waiting on us, and what are the top reasons?
- Which customers have the most past due value?
- Show the late purchase orders by vendor.
- Which orders are due next week in the CM warehouses?
- How was on-time delivery over the last 3 months?
- Load C:\Exports\kpi_export.xls and give me the overview. (Options 2 to 4 only)

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

The tools only read. Nothing is changed in SAP or in the export files. Notes saved in the dashboard in a browser are not visible to the connector, and neither are causes picked on lines or the at-risk history, so the connector decides each cause from the override status in the file and the SAP dates, and counts every at-risk line as new this week. The cause rules are in the dashboard under Order Health → About these numbers.

## Update the export

Save the new export over the old file (same path), then either:

- ask the AI to load it, for example "Load C:\Exports\kpi_export.xls" (it calls `load_exports`), or
- restart the AI app (Claude Desktop: quit it from the tray or menu bar, not just the window).

If the new file has a different name, change the path in the config too.

## Privacy

- The server runs on your computer and reads only the files you list (`.xlsx`, `.xls`, `.csv`, `.txt` or `.tsv` exports).
- The AI app you connect receives the tool answers (order lines, customers, vendors, values and dates) and sends them to its provider.
- Use only an AI app your company approves for this data.

## Troubleshooting

**Check that it runs.** In a terminal, from the dashboard folder:

```
node mcp/spyder-kpi-mcp.mjs --check "C:\path\to\kpi_export.xls"
```

It loads the file, prints the overview (the same numbers as Order Health and Purchase Orders) and exits. If the file cannot be read, it prints why and exits with code 1.

**"node" is not recognized / command not found.** Node.js is not installed, or the AI app started before it was installed. Install Node.js 18+ from [nodejs.org](https://nodejs.org), then restart the AI app (or the computer). `node --version` in a new terminal should print v18 or newer. If the app still can't find it, use the full path as the command, for example `"command": "C:\\Program Files\\nodejs\\node.exe"`. On a Mac, Claude Desktop does not see the Terminal's PATH (for example when Node.js came from nvm or Homebrew): run `which node` in Terminal and use the path it prints, such as `/opt/homebrew/bin/node`.

**Paths with spaces.** In the Claude Desktop config each path is its own quoted string in `args`, so spaces are fine. In a terminal command (Claude Code, `--check`), put each path in double quotes. Use full paths, not paths relative to the dashboard folder.

**The AI says no export is loaded.** The path in the config is wrong or the file was moved. Ask the AI to call `loaded_files`; it shows what is loaded and the last load error. You can also ask it to load the file by its full path.

**Claude Desktop shows the server as failed.** Open **Settings → Developer** to see the error. In Claude's MCP log for spyder-kpi, lines starting with `[spyder-kpi]` come from the connector. Common causes: a typo in the JSON (a missing comma or a single `\` in a path), or `index.html` is not in the folder above `mcp`. If `index.html` is somewhere else, add `"--index", "C:\\path\\to\\index.html"` before the export paths in `args`.

**The numbers differ from the website.** Check the as-of date (`loaded_files`). The connector reads the file you listed, which may be older than the one loaded in the browser.
