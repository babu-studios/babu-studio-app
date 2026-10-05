# Phase 3: Export and Format Conversion

## Goal
Give the user the ability to turn the master session into actual publishable MP4 outputs.

## Scope

| Item | Task | Deliverable |
|---|---|---|
| Export presets | Add 16:9, 9:16, and custom ratios | Export preset menu |
| Master session handling | Load saved master recording | Editable project workflow |
| Render engine | Convert master to final MP4 | Export output file |
| Video crop | Add crop and framing controls | Final layout preview |
| Output settings | Add resolution and quality controls | User-configurable export |

## Checklist
- [ ] Add export preset list
- [ ] Support 16:9 horizontal export
- [ ] Support 9:16 vertical export
- [ ] Support custom ratio export
- [ ] Render MP4 from raw master recording
- [ ] Add save path selection
- [ ] Add progress and completion states

## Exit criteria
- User can export at least 16:9 and 9:16 MP4s
- Raw master is preserved
- Final output is generated from the master without re-recording
