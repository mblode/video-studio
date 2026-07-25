# The Last Watch — shot list

One entry is one eight-second generation. Every entry opens on its same-id still
as `first_frame`. The JSON prompt expands each entry into three explicit camera
setups.

## s01 · `s01-final-arrival` · 8s · KEYFRAME

- **Frame:** aerial wide, white tower on the right third, cottage window warm
  below, headland path entering from lower left
- **Action:** keeper closes suitcase; relief appears on the path; he looks from
  her to the dark lamp
- **Camera:** aerial push, interior insert, long-lens path compression
- **Audio:** hard wind, window rattle, suitcase latch, distant surf
- **Continuity:** establishes suitcase, relative scale, lamp dark, relief still
  outside

## s02 · `s02-threshold` · 8s · KEYFRAME

- **Frame:** entrance two-shot divided by the open iron door
- **Action:** relief enters; offers a hand; keeper closes door and retains key
- **Camera:** lateral medium, hand insert, static table two-shot
- **Audio:** hinge, door slam, wet boots, key ring, two mugs
- **Continuity:** key remains with keeper; mugs are visibly separated

## s03 · `s03-two-methods` · 8s · KEYFRAME

- **Frame:** machinery-room two-shot with counterweight between them
- **Action:** keeper winds and listens; relief’s meter jumps; he moves it aside
- **Camera:** slow track, macro meter, locked medium
- **Audio:** chain lift, clockwork tick, electrical click, panel latch
- **Continuity:** sets up shudder, meter, and exclusion; no hand injury yet

## s04 · `s04-warning` · 8s · KEYFRAME

- **Frame:** radio-room medium, red warning lamp flashing between both faces
- **Action:** barometer falls; they cross to window; a boat vanishes into fog
- **Camera:** radio insert, quick pan, exterior telephoto
- **Audio:** radio static, alarm bell, rain on glass, low horn
- **Continuity:** no readable radio text; first boat glimpse; lamp still dark

## s05 · `s05-first-light` · 8s · KEYFRAME

- **Frame:** keeper at dark Fresnel lens, relief held behind him
- **Action:** ignition catches; drive engages; first beam crosses their faces
- **Camera:** locked medium, burner macro, circular wide
- **Audio:** gas hiss, flint strikes, ignition, gearing
- **Continuity:** solitary success before failure; relief studies the drive

## s06 · `s06-drive-breaks` · 8s · KEYFRAME

- **Frame:** low machinery-room angle, moving chain and flywheel dominant
- **Action:** lightning hits; chain snaps; flywheel and beam stop
- **Camera:** low track, macro break, exterior cliff wide
- **Audio:** thunder crack, chain whip, gear grind, alarm bell
- **Continuity:** beam freezes inland, away from sea; all people clear of chain

## s07 · `s07-boat-in-dark` · 8s · KEYFRAME

- **Frame:** sea-level wide, small boat left, white reef water ahead right
- **Action:** hull falls into trough; skipper searches for beam; weak signal
- **Camera:** riding wide, wheelhouse close, stern tracking
- **Audio:** hull impacts, labouring engine, signal horn, surf
- **Continuity:** anonymous skipper; no flags, names, or readable instruments

## s08 · `s08-force-fails` · 8s · KEYFRAME

- **Frame:** keeper kneeling at seized clutch with relief behind
- **Action:** he forces key; clutch kicks; she catches him and sees cut palm
- **Camera:** shoulder medium, hand macro, low two-shot
- **Audio:** key scraping, metal kick, body impact, breath
- **Continuity:** left palm injury begins; key stays in his right hand

## s09 · `s09-relief-acts` · 8s · KEYFRAME

- **Frame:** relief at open drive panel, keeper seated behind holding left palm
- **Action:** she traces circuit; uncovers clutch; places service motor by wheel
- **Camera:** precise lateral track, circuit close, overhead plan view
- **Audio:** probe clicks, cover bolts, tools, storm through stone
- **Continuity:** her first unpermitted action; solution is shown before payoff

## s10 · `s10-beam-returns` · 8s · KEYFRAME

- **Frame:** close two-shot of keeper offering key to relief over exposed gears
- **Action:** she accepts; he holds clutch; she couples motor; beam moves
- **Camera:** hand close, low drive angle, crane into lamp room
- **Audio:** key ring, motor rise, clutch clack, gearing settling
- **Continuity:** first shared action; key ownership changes during shot

## s11 · `s11-course-corrected` · 8s · KEYFRAME

- **Frame:** beam reaches boat as reef breaks behind it
- **Action:** wheel turns; bow swings; wake clears reef toward open water
- **Camera:** high sea wide, wheel close, stern pullback
- **Audio:** engine recovery, wheel chain, surf falling behind
- **Continuity:** mirror s07 geography so the corrected heading reads instantly

## s12 · `s12-the-handover` · 8s · KEYFRAME

- **Frame:** dawn table, two mugs together, keeper holding key above logbook
- **Action:** relief takes key; keeper leaves with suitcase; looks back once
- **Camera:** still-life close, doorway medium, long exterior
- **Audio:** mug set down, key on wood, door, calm wind
- **Continuity:** keeper’s left palm bandaged; no readable logbook text

## s13 · `s13-next-watch` · 8s · KEYFRAME

- **Frame:** mirror of s01 from inside lamp room, relief with key and meter
  sharing the foreground ledge
- **Action:** she winds, pauses to listen, starts lamp, watches beam find vessel
- **Camera:** hand close, medium profile, exterior aerial pullback
- **Audio:** clockwork rhythm, ignition, soft wind, distant sea
- **Continuity:** clear next dusk; final vessel is anonymous and very distant

## Paid setup audit

Every prop, action, and environment that needs to persist is introduced before
it pays off. The chain shudder precedes the break; the boat precedes the rescue;
the service motor is visible before it turns the lens; key ownership changes in
frame; and the final ritual repeats actions the relief witnessed.

## Dependency audit

All 13 shots are independent keyframes. There are no `continueFrom` edges and
therefore no serial generations, cascading retakes, or inherited visual drift.

## Edit audit

- s01–s04: 0.4–0.5 second transitions, enough space to read the handover
- s05–s10: 0.1–0.3 second transitions, tightening through crisis
- s11: 0.4 second release into the rescue
- s12–s13: 0.6–0.8 second transitions, returning to ritual and time passing
- Opening card is fully visible on frame zero
- Closing card follows the final proof image rather than replacing it
