# RepeatSplit — design

**Date:** 2026-08-05
**Target:** WoW TBC Classic Anniversary, build 2.5.6 (Interface 20506), Bagnon bags

## Problem

Splitting a stack repeatedly is four actions every time: shift+right-click, type the
quantity, confirm, drag to the destination. When making many equal stacks, only the
destination carries information — the source and the quantity never change.

## Goal

Set the quantity and the source stack once. After that, one click per stack: shift+
left-click an empty bag slot and a split of that size appears in it.

## Approach

Two hooks, each chosen because it is the point every bag UI funnels through.

1. **`OpenStackSplitFrame`** — the split dialog's entry point. Used to learn the
   quantity and to arm the source. Bagnon, Blizzard, ElvUI, bank and guild bank all
   route through it.
2. **`ContainerFrameItemButton_OnClick`** — the destination click. Empty slots never
   open the split dialog, so hook 1 cannot see them. Bagnon's item buttons inherit
   `ContainerFrameItemButtonTemplate` (`BagBrother/core/classes/item.lua:7`) and never
   override `OnClick`, so this global fires for them, empty slots included. Auctionator
   hooks the same global on this client build, which confirms it exists here.

### Behaviour

| Input | Result |
| --- | --- |
| Shift+right-click a stack | Normal dialog. Confirming it arms that stack and its quantity. |
| Shift+left-click an empty slot | A split of that size is placed in that slot. |
| Shift+left-click the armed source | Splits onto the cursor, for placing by hand. |
| Anything else | Untouched. |

### Arming

Learned from `hooksecurefunc` on `SplitContainerItem`, which supplies source bag, slot
and amount in one call. A second path reads `StackSplitFrame.split` on dialog confirm,
covering a bag addon that cached its own reference before we loaded.

Disarms when: the source empties, the source slot holds a different item, the bag
frame hides, or `/rs off`.

The bag frame is found by walking up the parent chain from a clicked button and
hooking its `OnHide`, so no bag addon is named anywhere in the code.

### Queueing

Splitting locks the source until the server confirms, so a burst of clicks cannot all
run at once. Destinations queue (cap 40) and drain on `ITEM_LOCK_CHANGED` and
`BAG_UPDATE_DELAYED`. Destinations that filled up meanwhile are skipped.

### Click de-duplication

`OnClick` and `OnModifiedClick` can both fire for one physical click. `GetTime()` is
constant within a frame, so a (frame, time) pair collapses them into one action.

### Short sources

If the source holds fewer than the quantity, `PickupContainerItem` takes the remainder
instead of failing, places it, then disarms.

### Guards

Acts only when shift is held, the cursor is empty, the destination slot is empty and
unlocked, and the source is valid and unlocked.

### API compatibility

Prefers `C_Container.*`, falls back to the pre-10.0 globals. The test suite runs the
whole flow twice, once against each shape.

## Non-goals

- Auto-choosing the destination; the player picks every slot deliberately
- Trade, mail or vendor destinations
- Saved variables — arming clears on reload

## Files

- `RepeatSplit/RepeatSplit.toc` — Interface 20506
- `RepeatSplit/RepeatSplit.lua`
- `RepeatSplit/tests/test_repeatsplit.lua` — mock bag, cursor and lock simulation
