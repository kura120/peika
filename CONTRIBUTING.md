# Contributing to Peika

Peika is a small animated cloud at the top of the screen. It shows your AI coding agent sessions and a few integrations, and lets you approve, answer, chat and drop files from it. It is a fork of Coucou. The maintained app is in `windows/` (Tauri: Rust and TypeScript, for Windows and Linux).

## Build and test

You need Rust and Node (see "Build it yourself" in `windows/README.md`; on Windows, also the MSVC build tools).

```
cd windows
npm install
npm run tauri dev          # development build
npx tsc --noEmit           # type check
npm test                   # TypeScript tests
cargo test --workspace     # Rust tests
```

The app bundles the hook relay, so build it first: `cargo build --release -p peika-hook`. `npm run dev` and `npm run build` do this for you. Run it yourself before `cargo test` on a fresh checkout.

`npm run dev` alone serves the front end in a browser; the character, outfits and states are at `/dev/mascot-preview.html`.

On every pull request that touches `windows/`, CI (Windows CI, and a Linux build) runs the type check, `npm test`, the relay build and `cargo test --workspace`.

## Rules

- No third-party dependencies unless there is really no other way.
- Secrets live in the system credential store, never on disk or in git.
- No telemetry. Network calls go only to services the user configured.
- Never block an agent: if Peika does not answer, the hook exits at once.
- Never overwrite an agent's settings file (for example `~/.claude/settings.json`) without a dated backup, a merge, a diff and the user's confirmation.
- Never send an email or approve an agent's permission request without an explicit click.
- Keep it light: 0 % CPU when the island is hidden. An animation that waits must keep a tween running, or the island's loop stops before the end is drawn.
- Pill IDs are stable. Never rename an existing one.
- Every release adds its section to `CHANGELOG.md`.

## Pull requests

- One topic per pull request, with a short GIF or screenshot for anything visual.
- The build passes with no new warnings.
- Branches: `feat/<area>-<topic>`, `fix/<area>-<topic>` or `chore/<topic>`.
- Title: `<Area>: <plain sentence>`, for example `Flow: keep a history of dictations`. No `feat:` prefix and no full stop at the end.
- Base branch: `main`.
- Body: bullets of what changed, then a last line `Checked: ...` with the real test results and what you did not try.

## The macOS and iPhone app

`NotchBuddy/` holds a macOS and iPhone app in Swift, and `relay/` its push relay. They were renamed to Peika but have not been built or tested in this fork. Treat changes there as untested, and say so in the pull request.

## Media and licence

The code is under the MIT licence (`LICENSE`). The sounds and other media are the original author's and are not covered by it: read `LICENSE-ASSETS.md` before using or distributing them.
