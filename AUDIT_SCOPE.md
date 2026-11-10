# Independent audit scope

Focus first on the combat-damage pipeline, shields/defense, direct/periodic/reflected/counterattack damage, and chained reactions. Compare manual combat, autobattle and simulator behaviour with deterministic tests.

Keep original sources unchanged. Classify findings as confirmed bug, probable bug, design question, or technical debt. State code locations, reproduction steps, and test outcomes.

Approved turn priority: player → allied summons → enemies by battlefield order.
The standard Shield absorbs damage before HP: defenses do not reduce Shield absorption, but reduce applicable HP overflow; certain intentionally piercing effects exist.

No private production credentials are included. Mock tests contain some synthetic identifiers.
