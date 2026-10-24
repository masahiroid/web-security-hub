# Use verification from an AI assistant (MCP)

[日本語](MCP.ja.md) · [Genetic search](GENETIC.md) · [OpenVEX](VEX.md) · [Basic course](README.md)

Web Security Hub can act as an [MCP](https://modelcontextprotocol.io/) server over standard input and output, so an AI assistant that supports MCP can read verification results, start verifications and prepare OpenVEX drafts. It runs on your machine, is not exposed over the network, and offers only what you allow when you start it.
Available in the source edition (Node.js 24 or later).

## 1. Start the server

Build once, then let your MCP client start the server:

```sh
npm run build:verifier
node core/verifier/generated/cli/mcp.js [--allow-run] [--allow-code-snippets] [--allow-vex]
```

An example client configuration (use the absolute path of your checkout):

```json
{ "mcpServers": { "web-security-hub": { "command": "node", "args": ["/path/to/web-security-hub/core/verifier/generated/cli/mcp.js", "--allow-run"] } } }
```

Launch it with `node`, not through `npm run`: npm prints its own lines to standard output, which would corrupt the protocol. The server writes only protocol messages to standard output and its log to standard error.

## 2. Permissions

Permissions are chosen by you when the server starts. The assistant cannot change them, and tools it is not allowed to use are not offered at all.

| Option | What it allows |
|---|---|
| (none) | Reading report summaries and job status, listing VEX drafts and asking for a suggested VEX status |
| `--allow-run` | Starting a sample verification or a genetic search on the built-in sample |
| `--allow-code-snippets` | Reading the exact synthetic candidate values and per-candidate results of a report |
| `--allow-vex` | Creating VEX drafts, saving statements, and exporting documents a person has approved |

Reports and drafts are stored privately on this machine, exactly as when you use the app.

## 3. Tools

| Tool | Needs | Purpose |
|---|---|---|
| `list_reports` | — | Saved reports with kind, observation and time |
| `get_report_summary` | — | Aggregate facts of one report (no inputs or values) |
| `get_report_details` | code snippets | Exact candidate values and results |
| `start_sample_verification` | run | Runs the sample verification; returns a job handle |
| `start_genetic_search` | run | Runs the genetic search or the fixed-rule baseline; language models are never used |
| `get_job_status` / `cancel_job` | — | Progress, aggregate result, cancellation of a job this server started |
| `vex_suggest_status` | — | Suggests *affected* only when a selected report reproduced a violation |
| `vex_create_draft`, `vex_save_statement` | VEX | Prepare an unapproved OpenVEX draft |
| `vex_list_drafts` | — | Drafts with version, state and statement count |
| `vex_export_document` | VEX | Returns the document of an approved draft |

## 4. Limits and safeguards

- **Approval stays with a person.** There is no tool to approve a VEX draft. Open the VEX workspace in the app, review the statements, and approve them there; only then can an assistant export the document.
- **One job at a time**, with bounded trials. A job handle works only for the job this server started; unknown or malformed handles are refused.
- **Rate limits** per minute: 60 reads, 30 writes and 6 job starts.
- **Aggregate by default.** Summaries and job results contain counts and states, not inputs or values.
- **Nothing is derived from absence.** A verification that finds nothing never produces *not affected*; the VEX rules are the same as in the app.
- **Finite trials do not prove safety.** Results describe the trials that were run.
