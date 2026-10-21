# Quartel do Clã — UI/UX

Base: GitHub origin/main, commit 43610a2. No local styling reused.

## Product
A companion for clan leaders to select the next war team using current availability and past war performance. The roster is a suggestion; the official lineup is set in the game.

## Visual direction
Tactical clan headquarters: warm basalt (#111510), ivory (#F3F1E8), brass gold (#E8BA62), emerald availability and muted red exclusions. Original shield crest, consistent 24px line icons. Barlow body, Barlow Condensed headings, self-hosted. No neon, decorative charts, marketing hero or emoji controls. Player-provided names are preserved.

## Experience
Desktop: comparison rows, full performance columns, right summary rail. Mobile: compact identity and metrics, expandable details, bottom navigation and copy action. Both offer Time, Critérios and Guerra with identical business rules. 44px minimum controls, 8px between actions, labelled native inputs, visible focus, reduced motion support.

## Information hierarchy
1. Clan and data freshness. 2. Selection size and availability. 3. Searchable selected/bench/all roster. 4. Reasons and overrides. Criteria and war report have dedicated views. TSV copy/download for Excel are the only data transfer features. There is no import flow. The development demo never replaces failed live data automatically.

## Skill application
ui-ux-pro-max design-system searches completed for gaming and team management. Adopted bold competitive typography, gold action color, touch targets and responsive table guidance. Landing-page patterns and retro-futurist effects were rejected because this is an operational tool. Existing native HTML/CSS/JS stack retained.

## Approved refinements
The user approved the visual direction on desktop and mobile. Import was removed at their request; all export actions use TSV for spreadsheets. First/second attack stars are shown separately, including in TSV; absent attacks use a dash and zero is preserved. Clan emblems use real API badge URLs. Town Hall icons are bundled from the WarReport CDN with a numeric level and a fallback. Historical personal stats open in a focused dialog, with normal/CWL filters; CWL uses per-war attack allowances. The user approved the layout and authorized PR, merge and publication. The favicon reuses the original application crest, with SVG, PNG and Apple touch variants.
