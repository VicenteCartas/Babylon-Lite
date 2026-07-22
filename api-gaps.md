# Babylon Lite — API gaps

Running notes on gaps in the public `babylon-lite` API found while building demos
and features, with the workaround used and a suggested addition. Intended to feed
future engine improvements.

## Audio: no public runtime pitch / playback-rate control

**Context:** The Racer demo's engine sound needs continuous pitch modulation
(playback rate ~`0.5×`→`3×`) tied to vehicle speed, alongside per-frame volume
changes.

**Gap:** The public audio API (`createSoundAsync`, `playSound`, `setSoundVolume`,
…) accepts `pitch` / `playbackRate` only in `StaticSoundOptions` at **creation
time**. There is no exported setter to change a playing instance's pitch/rate at
runtime. Only internal, underscore-prefixed helpers exist
(`_setNewestInstancePitch`, `_setNewestInstancePlaybackRate` in
`packages/babylon-lite/src/audio/static-sound.ts`), which are not part of the
public surface. Runtime volume is covered by `setSoundVolume`, so only pitch/rate
is missing.

**Workaround:** The Racer demo bypasses the Lite audio module and drives the raw
Web Audio API directly (as the other Lite demos do), setting
`AudioBufferSourceNode.playbackRate` and a `GainNode` itself.

**Suggested addition:** Public, ramp-aware `setSoundPlaybackRate(sound, rate,
options?)` and `setSoundPitch(sound, cents, options?)` mirroring `setSoundVolume`,
operating on the sound's live instance(s).

## Meshes: `visible = false` doesn't hide loaded glTF meshes

**Context:** The Racer demo preloads all selectable vehicles and shows one at a
time. The natural approach is to toggle `mesh.visible` on the meshes returned by
`getContainerMeshes(container)`.

**Gap:** Setting `mesh.visible = false` on glTF-loaded meshes does **not** hide
them, even though the render path skips `renderable.mesh.visible === false`
(`frame-graph/render-task.ts`, `geometry-renderer-task.ts`). The flag is written
(reads back `false`), but the geometry still renders — so the draw binding's
`renderable.mesh` apparently doesn't reference the same mesh objects that
`getContainerMeshes` returns for a loaded container. Primitive meshes (e.g.
`createBox`) hide as expected, so this is specific to loaded-container meshes.

**Workaround:** Move inactive models off-screen (`root.position.set(0, -1000, 0)`)
instead of toggling visibility.

**Suggested fix:** Ensure a loaded container's `renderable.mesh` points at the
mesh objects exposed by `getContainerMeshes`, so `visible` (and other per-mesh
render flags) apply — or provide a documented `setContainerVisible` / node-level
`enabled` toggle.

## Physics: no public angular-velocity getter

**Context:** The Racer demo's dynamic-sphere ("car ball") physics faithfully port
the kit's model, which propels the car by accumulating angular velocity on the
ball each frame (`sphere.angular_velocity += basis.x * speed * 100 * dt`).

**Gap:** The public physics API exports `setPhysicsBodyAngularVelocity` and both
`get`/`setPhysicsBodyLinearVelocity`, but **no** `getPhysicsBodyAngularVelocity`.
Without a getter, the read-modify-write needed to accumulate angular velocity
(roll propulsion) isn't possible through the public surface, even though the
native handle exposes `HP_Body_GetAngularVelocity`.

**Workaround:** Propel the ball with a central force proportional to the difference
between its current linear velocity and the target heading velocity. This preserves
momentum-based drift while leaving the contact solver in control at barriers, but it
isn't the kit's rolling model.

**Suggested addition:** Export `getPhysicsBodyAngularVelocity(world, body): Vec3`
to mirror the linear-velocity getter and the angular-velocity setter.
