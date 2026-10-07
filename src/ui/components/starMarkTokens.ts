/**
 * The single source of truth for the tokens StarBattleSurface places on a
 * cell's data-mark attribute. displayMark's return type derives from this
 * array, so TypeScript refuses a return value the array does not name; and
 * src/styles/starbattle.markTokens.test.ts checks the shipping stylesheet
 * against the same array, so an emitted token CSS does not style — or a
 * styled token the component cannot emit — fails a test instead of rotting
 * silently. That drift is not hypothetical: the sheet once keyed its locked
 * rules on a token that had been renamed in the component, and every locked
 * cell silently lost its styling.
 */
export const STAR_MARK_TOKENS = ['unmarked', 'blank', 'star', 'locked-star', 'locked-blank'] as const

export type StarMarkToken = (typeof STAR_MARK_TOKENS)[number]
