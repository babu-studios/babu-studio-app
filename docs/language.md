# Language and Stack

## Mac-only recommended stack

| Layer | Technology | Purpose |
|---|---|---|
| Frontend | React + TypeScript + Vite | Build the app UI, device selection, recording controls, and export screens |
| Desktop shell | Tauri | Package the app as a lightweight macOS desktop application |
| Native capture layer | AVFoundation + Core Audio + Core Media | Capture Elgato gameplay, webcam, and mic on macOS |
| Core processing | Rust | Handle raw master recording, performance-sensitive capture logic, and audio/video pipeline work |
| Final export | FFmpeg | Convert master recordings into MP4 outputs such as 16:9 and 9:16 |

## Why this stack

| Technology | Why it fits the Mac version |
|---|---|
| React + TypeScript | Fast UI development and clean state management for a creator-focused app |
| Tauri | Light desktop app performance on macOS and easier packaging than Electron |
| AVFoundation + Core Audio | Best native Apple APIs for display capture, camera input, and audio monitoring |
| Rust | Strong performance and safer handling for real-time capture tasks |
| FFmpeg | Reliable final MP4 rendering after recording the master file |

## Product flow for the Mac app

| Step | Function |
|---|---|
| 1 | Select Elgato 4K S as the gameplay source |
| 2 | Select webcam and headphone mic |
| 3 | Record raw master data |
| 4 | Send game audio to headphones |
| 5 | Pause or resume the session manually |
| 6 | Later export MP4 versions in 16:9, 9:16, or custom ratio |

The UI is built in React, while the capture pipeline uses native macOS libraries and Rust, with FFmpeg used only for final export.

## Summary

| Area | Recommended tool |
|---|---|
| UI | React + TypeScript |
| Desktop shell | Tauri |
| Mac capture | AVFoundation + Core Audio |
| Processing | Rust |
| Export | FFmpeg |

This is the Mac-only build path for the current version of the product.
