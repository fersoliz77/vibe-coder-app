# Project Overview

## Summary

Vibe IDE Coder is a desktop IDE-style application built with Electron and React. It is designed to manage local projects, inspect file trees, interact with terminals, connect external developer services, and use Claude inside a focused workspace.

## Primary Use Cases

- Open and manage local project folders.
- Browse and edit files inside a custom Explorer.
- Run shell commands in integrated terminals.
- Send prompts to Claude from the current project context.
- Check and manage developer service connectivity.
- Track project history and workspace state across sessions.

## Core Product Areas

- Project selection and recent project management.
- Dashboard for services and quick actions.
- Explorer with file management, editing, Git status, and drag/move support.
- Terminal workspace for command execution.
- Claude workspace for AI-assisted coding tasks.
- Custom titlebar and desktop-native window controls.

## Non-Goals

- Full replacement for mature code editors.
- Source control hosting platform.
- Cloud-only SaaS workflow.

## Tech Stack

- Desktop shell: Electron
- Frontend: React
- Build tool: Vite
- Editor: CodeMirror
- State management: Zustand
- Terminal emulation: xterm + node-pty

## Entry Points

- Frontend entry: `src/main.jsx`
- Main application shell: `src/App.jsx`
- Electron bootstrap: `electron/main.js`
- Secure bridge: `electron/preload.js`
