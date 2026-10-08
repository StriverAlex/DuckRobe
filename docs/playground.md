# Dressed Duck Playground

Choose **Try in playground** once the wardrobe duck has loaded. The current
selection, including chest/side/back accessories and body colors, transfers
automatically. Change outfits in the wardrobe and re-enter to use the new look.

| Control | Action |
| --- | --- |
| W / ↑, S / ↓ | Forward, reverse |
| A / ←, D / → | Turn left, right |
| On-screen direction buttons | Hold to steer; touch supports simultaneous forward/turn |
| Drag / pinch / wheel | Orbit / zoom; manual camera input disables following |
| Follow camera | Toggle tracking of the duck's position |
| Pause / Resume | Stop/restart simulation |
| Reset duck | Restore standing pose, controller history and camera; resume unless the tab is hidden; keep outfit |
| Back / Escape | Close and restore wardrobe focus and scroll |

Releasing controls or losing focus clears movement commands. Hiding the tab
pauses the simulation; returning requires explicit Resume. A sustained fall
pauses and offers Reset. Loading and errors always retain Back; Retry creates a
fresh worker and rendering session. Controls are translated into English and
Chinese and contained in a native modal dialog.

## Architecture and invariants

`src/main.js` opens a full-screen overlay without changing the saved/wardrobe
view or rebuilding its catalog. The preview's independent `setSuspended()`
stops its animation/render loop and thumbnail queue, preserving the motion
preference. Closing restores the mounted catalog, body scroll and focus.

`createPlayground({ host, selection, colors, language, sourceRig, onExit })` in
`src/playground/index.js` returns `pause()`, `resume()`, `reset()` and `dispose()`.
Its `rig` getter and read-only `getState()` snapshots support the existing
`window.duckrobe` diagnostic convention. It dynamically loads on first entry.
Every visit/retry owns an abort controller, worker, renderer, scene, resize
observer and animation frame. Disposal is idempotent; stale async results are
ignored and their geometry is disposed.

The dedicated module worker lazily loads MuJoCo and ONNX Runtime concurrently.
The main thread prepares collision STL buffers from the pinned GLB, caches one
successful model, and transfers independent copies to each new worker. Failed
or aborted preparations are not cached. The visual rig copies the wardrobe's
prepared native geometry and rebuilds its reference pose with independent
materials. Runtime initialization overlaps graphics setup and arena rendering.
The main thread sends `init`, `command`, `pause`,
`resume`, `reset`. The worker returns
`progress`, `ready`, `pose`, `fallen`, `reset`, `error`. No clothing or material
data crosses the physics boundary. Worker timers never overlap inference.
Each tick runs exactly one inference and four 0.005-second physics steps.
Slow devices slow simulation time instead of dropping physics steps or
building an unbounded catch-up queue.

The 61-value observation is gyro (3), projected gravity (3), joint positions
relative to the reference pose (14), joint velocities (14), previous action
(14), command (13). Command slots 0/1/2 are forward/lateral/yaw; lateral and
the ten head/body command slots remain zero. The 14 position targets equal
reference pose + policy output. Input velocities match upstream: +0.25 m/s,
−0.2 m/s, ±1 rad/s. ONNX uses one WASM thread, with no remote CDN or isolation
header requirement.

Physics uses the official simulator MJCF, **not** DuckRobe's export model.
Preparation removes visual geoms and unused assets, creates the official
floor/walls and STAND keyframe, and sets the timestep. It preserves robot
collisions, masses, inertias, actuator parameters and constraints. The source
file itself stays byte-identical. The reference kinematics fixture verifies
that the wardrobe renderer's body frames match the simulator.

`rig.js` retains clothing anchors made by `loadRobot()` in its reference pose,
removes the preview-only ground offset, and adds one Z-up → Y-up wrapper.
Root translation/quaternion and named joint angles come directly from physics,
including small excursions through MuJoCo's soft joint limits. Decorative
wardrobe animation is never called. Outfits cannot change dynamics.

Backpack and garden-pack harnesses receive a small placement adjustment toward
the visible torso surface to close their conspicuous reference-pose gap. This
is local to the Playground rig; wardrobe/export placement and physical
collisions remain unchanged. The following camera uses elapsed render time so
it stays with the duck even when rendering slows below the policy frequency.

All public, worker and WASM URLs resolve through Vite's base. Both `/` and
`/DuckRobe/` work on a plain static server. Simulation assets and runtime chunks
are unloaded until entry. Their raw sizes are approximately 2.1 MB
for model/policy data plus 23.6 MB of WASM (browser caching applies). The Vite
development server now serves those two WASM binaries with gzip when supported,
reducing their combined transfer to about 6.8 MB. Production compression depends
on the static host; the development middleware does not configure that host.
Saved-look storage and ZIP/export formats are unchanged.

## Provenance

Upstream is [Pollen Robotics Microduck Sandbox at
023172c8a7d629b5258d90364c13bafe013abbfa](https://huggingface.co/spaces/pollen-robotics/microduck-simulator/tree/023172c8a7d629b5258d90364c13bafe013abbfa).
`public/playground/manifest.json` records URLs and SHA-256 values for unmodified
assets and original adapted source files. Runtime versions are pinned in
`package-lock.json`. `THIRD_PARTY_NOTICES.md` distinguishes simulator assets
from the existing wardrobe/export assets.

## Validation and limitations

Local verification on 2026-10-03:

| Check | Result |
| --- | --- |
| Real MuJoCo / ONNX baseline, falls, reset, full/mixed/long outfits | Passed; bare and dressed fixed-step trajectories match exactly |
| Playground browser suite | 19/19 passed, including root, Pages base and fresh development cache |
| Existing wardrobe browser suite | 18/18 passed; zero browser errors |
| Catalog, behavior, hat/eyewear fit and asset paths | Passed |
| Export validation | 115 cases passed, including all 100 outfits |
| Production builds | Root and `/DuckRobe/` passed |
| Visual review | Complete and mixed looks, cape and linen dress; desktop, 390×844 portrait and 844×390 landscape |

The build retains the existing large-main-chunk warning. Run physics and
browser checks locally using [the contribution workflow](../CONTRIBUTING.md).
The Pages workflow builds and deploys the site; it does not run validation.

Run `npm run check:playground` for real WASM physics and policy inference,
asset hashes, observation layout, standing, translation/turning, reset,
perturbed falls and exact bare/dressed trajectory comparisons. Full and mixed
outfits are checked for anchor transforms, colors and body-frame compatibility.

Measured on the pinned policy with deterministic fixed steps: zero-command
standing stays within 3 cm for 10 seconds; forward translates 0.283 m in
3 seconds; left turns 1.05 rad in 3 seconds. Reverse from a fresh stand barely
moves (0.00002 m over 10 seconds), but after forward walking reverses 0.466 m
over 6 seconds. Right turns 0.229 rad from rest versus 1.609 rad after walking
over 3 seconds. These are observed limitations of this controller/model pair;
we retain the official command magnitudes. A few forward steps help initiate
reverse and tight turns. There is no separate running gait.

`npm run check:playground:ui` builds both deployment bases and uses a strict
static server plus real Chromium workers. It checks lazy loading, motion,
pause/reset, input release, camera follow, suspended wardrobe work, state and
focus restoration, repeated visits, exit during loading, missing assets,
invalid-policy startup, retry, English/Chinese and mobile layouts. It injects
visibility/fall/runtime-error events at the browser boundary to verify those
UI paths; the sustained-fall detector itself is tested with real MuJoCo data.
Screenshots and the machine-readable results are saved in `test-results/`.
The browser check also starts Vite with a fresh dependency cache to verify that
first entry does not reload the page while discovering lazy worker packages.

### Performance measurements

On 2026-10-04, a sequential local Chromium/SwiftShader comparison against
`6e86b9d` used the default look, a 1440×900 viewport, device pixel ratios 1 and 2,
and eight seconds of forward walking per visit. Startup measures the actual
click event to receipt of the worker's ready message. A first visit uses a fresh
browser context; a repeat uses the same page. Source instrumentation disables
HTTP caching in Playwright, so these are not ordinary browser-cache or
cold-network benchmarks.

| Pixel ratio / visit | Runtime readiness before → after | FPS before → after |
| --- | --- | --- |
| 1 / first | 0.98 → 1.11 s | 3.50 → 4.21 |
| 1 / repeat | 1.68 → 1.02 s | 3.66 → 3.79 |
| 2 / first | 1.23 → 1.19 s | 4.21 → 3.88 |
| 2 / repeat | 1.62 → 1.27 s | 4.00 → 3.32 |

Repeat runtime startup improved 22–39% in this single pass. First-entry timing
and FPS did not consistently improve. The worker sustained real-time
simulation, averaging 0.44–0.52 ms per control tick (inference and four physics
steps) across both versions. Rendering is the
remaining bottleneck in this software renderer. Removing unused floor
subdivisions reduced the default scene from 971,988 to 840,918 triangles per
frame (13.5%); the detailed CAD duck still accounts for most of the geometry.
These results do not establish native desktop or phone GPU performance.

Additional rendering-load changes on 2026-10-04 share only bit-identical
position/normal pairs after crease shading. For all 38 unique CAD parts,
stored vertices fall from 1,295,406 to 386,883 (70.1%), and position, normal
and index buffers from 31,089,744 to 11,876,004 bytes (61.8%). These are unique
geometry buffer totals for one rig, excluding textures, driver overhead and
temporary preparation allocations. The expanded triangle stream, winding,
normals and bounds remain identical. Download assets and physics are unchanged.
The indexing pass took about 78 ms in an isolated Node prototype; it runs once
during wardrobe mesh preparation, and Playground copies the prepared buffers.

A sequential 1440×900, pixel-ratio-1 SwiftShader prototype check measured
3.92/2.66 FPS before and 3.62/2.51 FPS after for first/repeat visits. This
does **not** establish an FPS improvement. Triangle count (840,918 in the
default scene), draw calls (165) and fragment work are unchanged. A lighter
display mesh or adjustable resolution is a separate visual-quality tradeoff
that should be evaluated on the affected native browser/GPU.

Paused and fallen scenes now redraw only when their pose, camera or canvas
size changes. Running and loading scenes continue rendering. Browser checks
verify zero draw calls while a paused camera is settled, followed by redraws
on drag, wheel zoom, resize and resume. Camera damping is allowed to finish
before drawing stops; a cheap animation-frame callback still observes controls.
`node scripts/validate-robot-geometry.mjs` verifies byte-identical expanded
geometry and the WebGL2 index-width boundary.

The performance changes also passed real WASM physics and geometry checks,
all 21 Playground browser checks, 7 studio checks, garment-fit checks,
127 export cases and root/Pages production
builds. Gzip responses matched the original runtime bytes under both development
bases, including HEAD, conditional requests and disabled gzip negotiation.

With Vite running, reproduce the measurements with:

```sh
node scripts/profile-playground.mjs local
```

Set `DUCKROBE_URL` for another development address and `DUCKROBE_QA_OUTPUT` for
the JSON output directory. The script records click-to-worker-ready startup,
stages, frame rate,
simulation/wall-time ratio, worker tick time, render submission time, triangles,
draw calls, pixel count and WebGL renderer. Render submission time measures CPU
work, not completed GPU work. Measure on the affected browser/device before
choosing reduced mesh detail or a lower render resolution.

Garments are rigid decorations: wide or long hems can intersect swinging legs,
and shoe soles can intersect the floor because contacts use the official bare
feet. No cloth physics, garment collisions, physical root lift, ZIP import,
rollers, multiplayer or extra Sandbox activities are included. Physical-phone
GPU performance is not established by responsive Chromium viewport checks.
