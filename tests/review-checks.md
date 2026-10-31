# Change review checks

Observed on October 31, 2026 against the React viewer, using the synthetic fixture from `node tests/stress-fixture.mjs`. The fixture has 60 versions of 120 delivery sections each. Saved times run from October 26 to October 31, so the list shows Today, Yesterday and three older days. Version 30 has a name of 131 characters. Versions 20 and 45 have three notes each.

These checks verify navigation and evidence visibility, not whether real stakeholders understand the interface.

Desktop checks ran in the in-app browser pane at 1440 by 900 (the page reported a 1441 px width). Phone checks ran at 375 by 812 (reported as 376 px). Reduced motion was checked in headless Chrome driven over the DevTools Protocol, because the pane has no reduced-motion switch.

## Desktop, 1440 by 900

| Case | Observed | Result |
| --- | --- | --- |
| 60 versions in the pill | The tick strip shows 12 ticks at v60, v30, v12 and v1. The pill never shows a name. | Pass |
| Pill width | 473 px at v60 (count 133), 460 px at v30 and v12 (count 0), 432 px at v1 (no count, Highlight and Compare disabled). Version v30's 131-character name gave the same 460 px as v12. Width follows the count and the disabled state, not the name. | Pass, with a note |
| 60 versions in the list | 60 rows in one scroll area, 286 px tall with 2,049 px of content. Rows are 32 px high and grouped Today, Yesterday, Oct 29, Oct 28, Oct 26. The current version is marked. No horizontal scroll. | Pass |
| Long name in the list | The 131-character name for v30 truncates with an ellipsis on one line. | Pass |
| List search | "very long" left one row (v30). "zzz" showed "No version matches “zzz”". | Pass |
| Per-version counts in the list | Only versions whose count was already computed show one: v60 133, v59 0, v58 1, v57 0. The rest are blank, as the spec allows. | Pass |
| Typing a version number | Clicking the field selected both digits. "75" then Enter showed "Pick 1 to 60" and kept v12. Esc restored 12 and removed the hint. "33" then Enter loaded v33 and focus left the field. | Pass |
| v60 against v59 | 133 changes: 109 changed, 12 added, 12 removed. Paging by 12 reached 133, 109, 12 and 12 entries for All, Changed, Added and Removed. | Pass |
| Removed "Delivery option 101" | Row 1 of 12 in Removed. The page swapped to v59 with a dashed red outline on the section, and the label read "Showing v59 · removed in v60". `K` from 1 went to 12 and `J` from 12 went to 1. Screenshot: `task-9-screens/desktop-removed-delivery-option-101.jpg`. | Pass |
| "Reserve this delivery" near the bottom | Entry 42 of 133. The page scrolled from 0 to about 13,320 px of 14,080. The button sat at y 502 of 900, clear of the pill (y 840) and the panel (x 1125 and up). The card showed "Choose delivery" then "Reserve this delivery". | Pass |
| v59 with no visible changes | Pill showed "No visible changes", panel showed "No visible changes since v58", no outlines were drawn, and `J` did nothing. | Pass |
| v58, background only | Panel read "1 change since v57" with "Background color · Page background" and `#fafaf8` to `#f1f2ef`. The page showed one outline and a card reading "Appearance changed · 1 of 1". | Pass |
| Compare v56 to v60, Wipe | Opens with the divider at 50. Labels "v56 Before" and "v60 After" sit in the bottom corners. The count is 134: the 133 from v60 against v59, plus the background change that arrived in v58. | Pass |
| Compare v56 to v60, Side by side | Two columns, 705 by 852 px each, each page laid out at the full 1441 px width and scaled. "Scroll synced" was on. Scrolling v60 to 3,000 moved v56 to 2,947.5 (page heights 14,980 and 14,747). Scrolling v56 to 6,000 moved v60 to 6,107.5. With sync off, v60 at 100 left v56 at 6,000. Screenshot: `task-9-screens/compare-v56-v60-side-by-side.jpg`. | Pass |
| Highlights in Compare | With `H` on in Side by side, both columns showed outlines and number markers. `J` opened a card on the After side: "Content changed · 1 of 134". | Pass |
| Links | `?version=v56&mode=compare&base=v60` became `version=v60&base=v56`. `?version=v2&mode=compare&base=v1` kept both. `?version=v1&mode=compare` fell back to explore, because v1 has no earlier version. | Pass |
| Keyboard while typing | In an input injected into the prototype, the keys `] g l h j k b c v ?` produced 10 key events. They all reached the input, which ended up holding "]glhjkbcv?". The version, panel and help sheet did not change. The same keys in a contenteditable element did nothing either. Outside a field, `[` stepped back one version. | Pass |
| Esc order | In Compare with the panel and help sheet open, the first Esc closed the help sheet, the second closed the panel, the third left Compare. | Pass |
| Panel search field | Typing shortcut letters into the version search left the link unchanged. This check typed text rather than sending key events, so the prototype-field result above is the stronger one. | Weak pass |
| Reduced motion | See the next section. | Pass |

## Reduced motion

Chrome with `prefers-reduced-motion: reduce` emulated, compared with no preference. Values were sampled about 30 ms apart.

| Moment | No preference | Reduced |
| --- | --- | --- |
| Panel opening (`V`) | x moved 727, 954, 1082, 1115, 1121, 1123. Opacity rose from 0.54 to 1. | Final position and opacity 1 on the first sample. |
| Stepping to a change (`K`) | Page scroll went 0, 34, 152, 294, 643, 1,239, 2,251, 3,859 on the way to 13,323. | 13,323 on the first sample. |
| Opening the versions folder | Height went 49, 162, 262, 319, 332, 334. | 335 on the first sample. |

## Phone, 375 by 812

Run on a fresh fixture built from the code with the phone fix (picking a change closes the sheet). The window reports 376 px wide. There was no horizontal overflow in any state (scroll width 376).

| Case | Observed | Result |
| --- | --- | --- |
| Pill | 220 by 44 px, centered, showing `v60`, a highlight icon with the count, and a Compare icon. Buttons are 34 px tall. Screenshot: `task-9-screens/phone-v60-pill.jpg`. | Pass |
| Panel | Opens as a bottom sheet, 364 px wide with a 6 px gutter. 260 px tall with all folders closed. Screenshot: `task-9-screens/phone-v60-sheet.jpg`. | Pass |
| 60 versions in the sheet | Opening "59 earlier versions" showed 60 rows of 44 px in a 286 px scroll area (2,770 px of content), grouped Today, Yesterday, Oct 29, Oct 28, Oct 26, with a search field and no horizontal scroll. The 131-character name truncates with an ellipsis. With the list open the sheet was 603 px tall. | Pass |
| Version search | "very long" left one row (v30). "zzz" showed "No version matches “zzz”". | Pass |
| Picking a version | Searching "45" and tapping the row loaded v45. The pill read `v45`, and the link became `?version=v45&mode=explore`. The sheet stayed open, which is how it works for versions. v45's three notes showed the first one and a "2 more" link. The pill's latest button (labelled "Latest" on a phone) returned to v60. | Pass |
| Typing a version number | There is no number field on a phone. The pill's version is one button that opens the sheet, and the keyboard shortcut `G` has no keyboard to use. Picking from the sheet's list is the way to go to a version. | Not available by design |
| Change count | 134 for v60 against v59 (110 changed, 12 added, 12 removed), against 133 at 1440. The page lays out differently at this width, and the spec lists that as a known constraint. | Pass, with a note |
| Removed "Delivery option 101" | In the Changes folder, Removed showed 12 rows. Tapping "Delivery option 101" closed the sheet. The page switched to v59 with the dashed red outline, heading at y 320 to 350 of 812, and the label "Showing v59 · removed in v60". The pill read "1 of 12". Next went to change 2 (heading 102 at y 319) and 3, previous went back to 2 and 1, and previous from 1 wrapped to 12. Screenshot: `task-9-screens/phone-removed-delivery-option-101.jpg`. | Pass |
| "Reserve this delivery" from the list | With the Changes folder open (sheet 575 px tall), tapping entry 42 closed the sheet. The page scrolled so the button sat at y 470 to 509, with the pill at y 757 and nothing over it. The card read "Reserve this delivery · Text" with "Choose delivery" then "Reserve this delivery". The link was `?hl=1&change=42`. The pill stepper then moved to 43 and back to 42. Before the fix, the same tap left the button hidden behind the open sheet. Desktop still keeps the panel open after picking a change. | Pass |
| v59 with no visible changes | Pill read "0", the highlight button read "No visible changes. Turn highlights off", and there was no stepper. The sheet said "No visible changes since v58" and was 258 px tall. | Pass |
| v58, background only | Panel read "1 change since v57". Tapping "Background color · Page background" (`#fafaf8` to `#f1f2ef`) closed the sheet, outlined the page, and showed the card "Appearance changed · 1 of 1". The pill read "1 of 1". | Pass |
| Compare v56 to v60 | Opened with the Wipe divider at 50, labels "v56 Before" and "v60 After", and a pill reading `v56 → v60` with a count of 135 and a leave button. There is no Side by side toggle, no number fields and no Compare button. A `layout=side` link opened Wipe on both frames at the full 376 by 813. The address bar kept `layout=side`. The sheet read "135 changes from v56 to v60". Picking change 3 closed the sheet, and the pill's next button moved to 4. | Pass |
| Change card in Wipe | First pass: the card for change 4 straddled the divider and its left part was covered by the Before side. After the final fix wave, stepping to a change whose region sits on the hidden side moves the divider just past it, and the card stays on the visible side. On v59 → v60, removed change 10 showed with the divider at the right edge and its card fully readable. | Pass |

## What this does not cover

- Chromium only. Wipe's click routing was not checked in Safari or Firefox.
- Counts depend on the window size, so a phone and a desktop can report different numbers for the same pair.
- The fixture uses stable IDs. It does not show how well highlights match arbitrary rewritten markup, dynamic applications, or interaction changes. Use Side by side for interaction changes.
- Holding `B` was not exercised in this pass, on desktop or phone. The browser tool cannot hold a key and a phone has no keyboard. `tests/keyboard.test.mjs` covers it.
- Phone checks used scripted clicks in an emulated 375 by 812 window, not a touch device. Touch gestures such as dragging the Wipe divider or the sheet were not exercised.
- Typing a version number on a phone is not covered because the field does not exist there.

## Stakeholder task script

Give a reviewer the fixture without explaining the colors or locating the changes for them. Ask them to complete these tasks:

1. Find a changed delivery price. State the previous and current price.
2. Find a removed delivery option. Show where it appeared before.
3. Find the button text change near the bottom. State both labels and show the new button.
4. Explain whether the background-only version changed any text.
5. Choose an older version and state which version the highlights compare against.

Record task completion, wrong answers, requests for help, and time to locate the relevant evidence. A task passes only when the reviewer gives the correct answer and locates the corresponding region without coaching. Do not count a successful automated click as evidence that a stakeholder understands the interface. No stakeholder sessions have been conducted yet.
