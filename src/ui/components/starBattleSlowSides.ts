/**
 * The Star Battle board sides whose generation is measured to cost far more
 * than their neighbours — accepted-board wall time on this machine class:
 * n = 6 ≈ 1.3 s, n = 8 ≈ 8 s, n = 10 ≈ 60 s, n = 12 produced no board in
 * the measurement window. The player has chosen n = 10 as a real but
 * deliberately slow option, so the honest marker list is exactly [10]: the
 * size selector wears the cost on the option itself, not in a general hint.
 *
 * This is a UI-local constant on purpose: `src/ui/layerBoundary.test.ts`
 * forbids importing values from src/domain / src/engine, and the cost is a
 * measurement, not a domain rule — the domain bound MAX_STAR_SIDE must not
 * be repeated here, and the selector's range keeps coming from the
 * `minSide` / `maxSide` props.
 *
 * To regenerate: benchmark accepted-board wall time per offered side with
 * the current engine and add a side when its median cost is clearly above
 * the next smaller offered side (an order of magnitude is the bar n = 10
 * clears against n = 8). Update this list and, if the meaning of "slow"
 * shifts, the option's accessible wording in StarBattleSurface's copy.
 */
export const SLOW_STAR_SIDES: readonly number[] = [10]
