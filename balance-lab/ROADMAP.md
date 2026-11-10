# Simulator and Balance Lab roadmap

## 1. Search reliability and storage — first implementation

- Manual-only Windows packaging; automatic checks produce no artifacts.
- Top 3–5, current configured build as baseline, held-out validation seeds.
- Compact intermediate ranking records; bounded rejection diagnostics.
- Baseline comparison and consumables per route in exports and UI.

## 2. Shared battle execution — initial implementation complete

- Done: common command dispatch for UI and simulator; production owns legality.
- Remaining: consolidate initialization and finalization for actual autobattle.
- Done: React-independent command executor and opt-in diagnostic replay.
- Done: session RNG through production hooks; no global Math.random replacement.
- Done: versioned recordings with bounded commands and state/RNG verification.
- Remaining: standalone snapshot hydration and versioned reward/result contract.
- Verify identical final state for manual action replay and accelerated execution,
  including summons, status expiry, deaths, cooldowns and consumable accounting.
- Treat action limits and invalid states as errors, never wins or ordinary losses.

## 3. Configurable scenarios and policies

- Single encounter, exact boss, encounter suite and current hex expedition.
- Hero progression, available gear, curses, zone modifiers and initial state.
- Configurable targeting, skill conditions, consumable limits and reserves.
- Explain decisions using structured events rather than parsing presentation logs.
- Keep experimental balance overrides outside production execution.

## 4. Build search

- Explicit available-item pools, required/excluded skills and fixed equipment slots.
- Objectives: completion probability, resource cost, action count; show tradeoffs.
- Absolute and diverse top lists; improvement with a limited number of changes.
- Search interactions across gear, talents and policies, with a bounded work budget.
- Separate candidate discovery, selection and independent final reporting samples.
- Compare fixed encounter suites or persisted hex routes; expose paired uncertainty.
- Preserve full configuration, code revision and seeds for reproduction.

## 5. Expedition integration and future autobattle

- Consolidate current hex crafting runner and expedition rules before reporting
  full-route balance; include keys, sublocations, Abyss power and resource depletion.
- Implemented: opt-in autobattle in encounter preview, review before accepting,
  one final manual attempt from initial state, normal reward/death handling.
- Implemented: persist encounter and player choice before revealing/continuing;
  accepted result uses existing reward finalization and inventory reconciliation.
- Availability: opt-in before encounter entry, only after a confirmed boss
  victory in that location; unlocks persist across deaths and class changes. Defeat can be accepted or retried
  manually; once autobattle starts, retreat is unavailable.

## Storage constraints for all stages

- Never run build searches or Windows packaging on game deploys.
- No committed binaries, full traces or automatically accumulated run reports.
- Detailed traces are opt-in and bounded; ordinary reports store aggregates.
- If history is introduced, enforce size/age limits and support pinned runs.
- Do not delete old shared artifacts automatically as part of a code refactor.
