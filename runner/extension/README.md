# VS Code / Cursor Extension

This directory is reserved for a future VS Code/Cursor extension that provides a GUI panel for running red team assessments.

## Status

**Planned. Not yet implemented.**

The extension would provide:
- A sidebar panel to create and manage configs
- Visual test plan builder
- Real-time assessment progress and results
- Report viewer with filtering and export

## For Now

Use the **CLI runner** (`runner/cli/`) to run assessments from the command line:

```bash
npx astra run --config astra.config.md
```

Or invoke the skills directly from your Claude Code or Cursor agent by reading the skill files.
