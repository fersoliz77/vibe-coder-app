# Documentation Standard

## Objective

Documentation must be understandable by:

- a new engineer
- a technical reviewer
- a future maintainer
- an AI agent operating without prior context

## Required Standards

- Use explicit filenames and section names.
- State purpose before implementation detail.
- Reference real source files when describing behavior.
- Record both `what changed` and `why it changed`.
- Keep operational history dated.
- Avoid undocumented assumptions.

## Update Triggers

Update documentation when:

- architecture changes
- directory structure changes
- IPC surfaces change
- user-facing behavior changes
- workflows or maintenance steps change

## Authoring Rules

- Prefer Markdown.
- Use short sections and predictable headings.
- Keep line-of-thought stable: purpose -> design -> behavior -> caveats.
- Do not write placeholder notes such as `todo docs later`.

## AI Handoff Rule

Any AI or engineer picking up work should be able to answer these questions from the Docs folder alone:

- What is this app?
- How is it structured?
- Where does a feature live?
- How does data move between renderer and Electron?
- What changed recently?
- What areas are risky or complex?
