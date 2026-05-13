# Refactor plan — `AudioEngine`

**Source:** `src/packages/client/src/audio/audio-engine.ts` (695 lines, single class)
**Trigger:** graphify community C9 — every method lives in one file; cohesion 0.09 because the class owns five orthogonal concerns.
**Goal:** keep the public surface (`AudioEngine`) but back it with focused sub-modules so each concern is testable in isolation.

## Current state

`AudioEngine` is one class that handles:
- AudioContext lifecycle & resume-on-interaction
- HTMLMediaElement attach + MediaStream-routing decision
- Output-device routing (Web Audio sink selection, default-device pinning)
- EQ filter chain (band gains, Q, frequency analyser)
- Compressor + dry/wet mix + makeup gain
- Input-gain trim + dB↔linear helpers

This is the only audio entry point used by the UI. It's not a god class in the "rotting" sense — it's coherent — but it's grown to the point where the EQ tab, compressor tab, and output-device picker each only use ~20% of the surface, and changes to one concern keep touching the same 700-line file.

## Proposed split

The public class stays. The internals delegate.

```
AudioEngine                       ← public surface (unchanged)
 ├─ AudioContextManager           ← ctx lifecycle, resume, attach, MediaStream routing
 ├─ OutputDeviceRouter            ← listOutputDevices, setOutputDevice, pinOutputAudioToDefault, startOutputAudio
 ├─ EqEngine                      ← filter chain, updateBand/Q, setBands, getFrequencyData, getTimeDomainData
 ├─ CompressorEngine              ← compressor + dry/wet mix + makeup gain + rebuildChain
 └─ MixerCore                     ← inputGainNode, setInputGain, dbToLinear (used by all of the above)
```

| Module | Responsibility | Methods that move |
|---|---|---|
| **`AudioContextManager`** | Own `ctx` + `attached` + `boundElement`. Decide MediaStream-vs-source routing. | `attach`, `register`, `ensureContext`, `resume`, `installResumeOnInteraction`, `removeInteractionResumeListener`, `isAttached`, `getSampleRate` |
| **`OutputDeviceRouter`** | Sink selection, default-device behavior, hidden audio element used for routing. | `listOutputDevices`, `setOutputDevice`, `pinOutputAudioToDefault`, `startOutputAudio` |
| **`EqEngine`** | Filter chain + analyser. | `setEqEnabled`, `getEqEnabled`, `updateBand`, `updateBandQ`, `setBands`, `getBands`, `resetEq`, `getFftSize`, `getFrequencyData`, `getTimeDomainData` |
| **`CompressorEngine`** | Compressor params + dry/wet mix. | `setCompressorEnabled`, `getCompressorEnabled`, `setCompressorSettings`, `getCompressorSettings`, `applyCompressorSettings`, `resetCompressor`, `getCompressorReduction`, `applyMix`, `rebuildChain` |
| **`MixerCore`** | Input gain + level helpers. | `setInputGain`, `getInputGain`, `dbToLinear` |
| **`AudioEngine`** *(facade)* | Constructs the five above, wires graph nodes, exposes the flat API. | `destroy`, plus delegating one-liners for each public method. |

## Why these boundaries

- **AudioContext lifecycle** is reentrant and hard to reason about — Safari, Chrome, and Firefox each have their own resume/suspend rules. Putting it behind one object means EQ and compressor code stops carrying conditional `if (this.ctx)` branches.
- **Output device routing** is the noisiest area (sinkId fallbacks, default-device pinning, the hidden audio element). It's the thing most likely to break per-browser; isolating it lets us mock it for tests.
- **EQ vs compressor** are the two "real" DSP modules. They are both rebuilt by the same `rebuildChain` today; after the split, `rebuildChain` becomes `CompressorEngine.rebuildChain` and EQ stops caring.
- **MixerCore** is shared utility — input trim + dB conversion. Cheapest extraction; pulls 3 methods out and lets the others stop knowing about gain math.

## Migration steps

1. **Extract `MixerCore`** — pure dB↔linear helpers + the inputGainNode wrapper. No state crosses module boundaries.
2. **Extract `EqEngine`** — filter array, analyser, band ops. The `AudioEngine` facade keeps a reference and delegates.
3. **Extract `CompressorEngine`** — compressor + dry/wet + `rebuildChain`. After this, `AudioEngine` only owns the graph wiring between modules, not the inner DSP.
4. **Extract `OutputDeviceRouter`** — owns the hidden audio element and sink-id state.
5. **Extract `AudioContextManager`** — `ctx`, `attached`, `boundElement`, resume listener. Last because everything else depends on it.
6. **`AudioEngine` becomes a facade** — constructor instantiates the five, wires `inputGain → eq → compressor → output`, exposes the same public methods as one-line delegators. No call-site changes in `useVideoEngine.ts`, `EqTab.tsx`, `CompressorTab.tsx`, `EffectsPanel.tsx`.

## Risk notes

- **Single global instance:** `AudioEngine` is created once and shared via a videoEngineRef. The facade must keep the same singleton lifetime — don't introduce per-call instantiation.
- **Resume-on-interaction listener:** browsers gate AudioContext.resume behind a user gesture. The listener is currently installed on first attach; the new `AudioContextManager` must do exactly the same on the same trigger.
- **MediaStream routing decision:** `useMediaStreamRouting` is set based on `setSinkId` support and a few heuristics. After the split, this decision belongs to `OutputDeviceRouter` but `AudioContextManager.attach` reads it. Pass it as a constructor arg so the dependency direction is explicit.
- **Settings persistence:** EQ + compressor settings are read from `useUiSetting` / signal state. The split should not change *who* reads/writes settings — keep that in the existing `audio-effects.state.ts` and `audio-profiles.state.ts`. The engine just receives settings via setters.
- **Bundle size:** `audio-engine.ts` is in the player critical path. Split modules must end up tree-shaken into the same chunk. Prefer a single `audio/` directory and a barrel export.

## Out of scope

- Auto-EQ / Auto-compressor logic (already lives in tab components).
- Output-device UI (`EffectsPanel.tsx`).
- The Web Audio polyfills / shims.

## Definition of done

- `audio-engine.ts` < 200 lines (facade only).
- Each new module has a single responsibility and ≤ ~150 lines.
- No call site outside `audio/` imports anything except `AudioEngine`.
- The five player smoke flows still pass: open movie → audio plays → EQ slider moves spectrum → compressor toggle changes loudness → output device switch routes correctly → tab away/back resumes context.
