# Shorter fight briefings

The default walkthrough should teach one player decision per step. Setup, action,
and recovery play as one animation wherever they belong to the same decision.

1. Add a curated briefing registry over the existing detailed steps. Preserve
   source timing and simulation behavior; keep extra stops for group changes,
   tank handoffs, and interrupt ordering.
2. Make this the default. Show total briefing progress, exclude full-cycle and
   alternate-strategy examples from Next/Previous, and expose them separately.
   Play full-cycle examples continuously with live narration.
3. Show one main instruction and a short explanation on the map. Keep positioning
   assignments visible; move supporting reasoning, role notes, spell descriptions,
   and common mistakes into expandable details. Retain the detailed walkthrough.
4. Verify complete animation coverage, navigation in both directions, optional
   examples and return, roster warnings during merged steps, reduced motion,
   exports, and desktop/mobile rendering. Run the existing Node and browser suites
   alongside tests for the new default, then independently review the change.

Target: roughly halve default stops, with lighter briefings for Naj’entus and
Akama and more deliberate sequencing for Bloodboil and Reliquary. No mechanic or
guild-strategy changes are intended.

Implemented default stops: Naj’entus 6, Supremus 13, Akama 11, Bloodboil 16,
Reliquary 20, Mother Shahraz 7. Mother keeps the full cycle and door formation as
optional examples. The original detailed registry remains available through
`?view=detail`; mode links retain the current chapter. Full-cycle examples use
one continuous animation with changing narration, and return to the originating
briefing step. Missing-role messages still resolve at each underlying event.
