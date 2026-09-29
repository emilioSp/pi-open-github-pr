# pi-open-github-pr

A Pi extension that uses the agent to inspect committed changes, generate a pull request title and description, and open or update the GitHub Pull Request.

## Prerequisites

The current checkout must be a Git repository with an `origin` remote. The `git` executable and authenticated GitHub CLI (`gh`) must be available.

The extension supports macOS and Linux. Windows is not supported.

## Installation

Install the package in Pi with:

```bash
pi install npm:@emiliosp/pi-open-github-pr
```

## Usage

Load the extension in Pi, then run:

```text
/open-github-pr
```

Pi inspects the current branch and reads the committed diff. The agent then generates a concise pull request title and description, fills the [pull request template](templates/pull-request_template.md), and uses the dedicated tools to push existing commits and create or update the open Pull Request.
During the active workflow, agent Bash commands are blocked; the dedicated extension tools perform the repository operations.

## Pi api

| api | what | when |
| --- | --- | --- |
| `ExtensionAPI.registerCommand` | Registers the `/open-github-pr` command. | During extension initialization. |
| `ExtensionAPI.registerTool` | Registers the repository inspection and pull request publishing tools. | During extension initialization. |
| `ExtensionAPI.sendUserMessage` | Starts the guided pull request workflow. | After `/open-github-pr` is accepted. |
| `ExtensionAPI.on` | Handles tool-call guards and workflow cleanup events. | During activation, agent settlement, and session shutdown. |
| `ExtensionContext.isIdle` | Checks whether another agent turn is running. | Before starting a workflow. |
| `ExtensionContext.ui.notify` | Shows workflow status and warning messages. | On invalid workflow state. |
| `ExtensionContext.ui.setStatus` | Shows or removes the active workflow status. | During workflow activation and cleanup. |
| `ExtensionContext.ui.theme.fg` | Colors the active workflow status. | When the status is displayed. |
| `ExtensionContext.cwd` | Provides the current checkout path to tools. | During tool execution. |
| `defineTool` | Defines a Pi tool and its execution handler. | In each tool module. |
| `Type.Object`, `Type.String`, `Type.Array`, `Type.Boolean` | Defines tool input schemas. | When the tools are registered. |
