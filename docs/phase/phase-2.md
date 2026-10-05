# Phase 2: Device Selection and Capture Pipeline

## Goal
Build the capture layer so the app can connect to the Elgato 4K S, webcam, and mic, and record the master session.

## Scope

| Item | Task | Deliverable |
|---|---|---|
| Device detection | Detect Elgato capture devices | Device list in app |
| Webcam input | Add webcam source selection | Webcam preview |
| Mic input | Add microphone selection | Audio source selection |
| Audio monitoring | Route game audio to headphones | Real-time headphone monitoring |
| Master recording | Record raw master data | Session saved locally |
| Pause/resume | Add session control | Recording lifecycle support |

## Checklist
- [ ] Build device discovery for Elgato, webcam, and mic
- [ ] Add UI for selecting capture sources
- [ ] Add live preview for gameplay and webcam
- [ ] Implement audio monitoring to headphones
- [ ] Record raw master session to disk
- [ ] Support pause and resume
- [ ] Manage sessions and timestamps

## Exit criteria
- User can select devices
- App records gameplay + webcam + mic together
- Raw master file is saved successfully
- Game audio is heard in headphones during capture
