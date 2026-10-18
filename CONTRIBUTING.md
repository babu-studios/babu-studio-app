# Contributing to Babu Studio

Thanks for helping! Babu Studio is a macOS app made of an Electron shell, a React renderer and a C++ media core. See [docs/folder-structure.md](docs/folder-structure.md) and [docs/development/setup.md](docs/development/setup.md) for how the parts fit together.

## Set up

Requirements: macOS, Node.js 20+, CMake 3.20+, Xcode Command Line Tools, and FFmpeg with pkg-config.

```sh
brew install cmake pkg-config ffmpeg
git clone https://github.com/babu-studios/babu-studio-app.git
cd babu-studio-app
npm install
npm run dev
```

`npm run dev` builds the C++ core and starts Electron with hot reload. In development the app uses your system FFmpeg (or `BABU_STUDIO_FFMPEG_PATH`). Grant camera and microphone access to your terminal or editor when macOS asks.

## Workflow

1. Fork the repo and create a branch from `main`, for example `fix/export-progress` or `feat/new-layer-type`.
2. Make a focused change. Keep unrelated edits out of the pull request.
3. Run the checks below.
4. Open a pull request against `main`. Describe what changed and why, and add screenshots for UI changes.

## Checks

```sh
npm run typecheck
npm run test:core
npm run build
```

CI runs these on every pull request. To try the recording and export pipeline without hardware, run `npm run test:recording-flow` (see [docs/flow.md](docs/flow.md)).

## Code guidelines

- TypeScript in the renderer and Electron main process. C++20 in `core/`, Objective-C++ in `platform/macos/`.
- The renderer never talks to the media core directly. It goes through the typed preload bridge and Electron IPC.
- Follow the style of nearby code. Comment only where the reason isn't obvious.
- Don't commit build output (`out/`, `release/`, `core/build/`) or secrets.

## Building an installer locally

```sh
npm run package:mac
```

This builds the core, bundles it with FFmpeg and its libraries, and writes an ad-hoc signed `.dmg` and `.zip` to `release/`. The installer matches the architecture of the Mac you build on.

## Releasing (maintainers)

1. Update `version` in the root `package.json` and `apps/desktop/electron/package.json`.
2. Merge to `main`, then tag and push:

   ```sh
   git tag v0.2.0
   git push origin v0.2.0
   ```

3. The **Release** workflow builds Apple Silicon and Intel installers and attaches them to a GitHub release. The website download buttons use `releases/latest/download/Babu-Studio-<arch>.dmg`.

The website in [website/](website) deploys to GitHub Pages from `main`. Enable it once under **Settings → Pages → Source: GitHub Actions**.

## Reporting bugs

Open an [issue](https://github.com/babu-studios/babu-studio-app/issues) with your macOS version, chip (Apple Silicon or Intel), capture devices, and steps to reproduce. Attach logs if you have them.
