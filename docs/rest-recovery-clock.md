# Camp recovery and the clock

KG Realms does not disable Rest Recovery's global time-passage setting or change its active profile. There is no global setting to restore after a camp.

## A KG Realms camp

The camp controller advances world time through setup, watches and packing. At Rest complete, `scripts/ui-camp.mjs` calls `promptCompletedCampRest` from `scripts/rest-recovery.mjs`. The helper calls `game.restrecovery.promptRest(actorIds, true, newDay)` to create recovery requests for the party. The camp records that request before calling the external API, preventing another click or GM handover from issuing it twice.

Rest Recovery's `promptRest` API creates the request cards without advancing the clock. When a player answers a card, D&D 5e's `Actor5e.handleRestRequest` calls `initiateRest` with `advanceTime: false`. Character recovery uses the active Rest Recovery profile while the already-played camp time is counted once.

The `newDay` argument describes whether the camp crossed a calendar date. It affects recovery rules; it does not advance the clock.

## An ordinary Rest Recovery rest

Rest Recovery's normal GM prompt takes a different path. Its `PromptRestDialog.doRest` reads the selected profile and, when its normal time-passage option is enabled, calls `game.time.advance(timeChanges.restTime)` before creating the party's request cards. Individual card responses still do not each add another rest's duration.

Keep that Rest Recovery option enabled if normal rests should advance time. If a GM or an earlier installation disabled it, enable it in Rest Recovery. KG Realms deliberately does not change that preference.

## Source references

- KG Realms: `scripts/rest-recovery.mjs`, `promptCompletedCampRest`; `scripts/ui-camp.mjs`, `#recover` and legacy `#breakCamp`.
- [Rest Recovery API](https://github.com/roth-michael/FoundryVTT-RestRecovery/blob/main/scripts/api.js), `promptRest`.
- [Rest Recovery GM prompt](https://github.com/roth-michael/FoundryVTT-RestRecovery/blob/main/scripts/apps/promptRest.js#L155), `doRest` and `ENABLE_PROMPT_REST_TIME_PASSING`.
- [D&D 5e 5.3.3 request handler](https://github.com/foundryvtt/dnd5e/blob/release-5.3.3/module/documents/actor/actor.mjs#L2247), `handleRestRequest`.

The upstream source paths were checked for this release. This documents source behavior, not a live test against the remote Foundry installation. The Rest Recovery main-branch references can change upstream.
