import type { Copy } from '../copy'

/**
 * What the board region says before there is a board.
 *
 * A puzzle that is "printed one round at a time" should look unprinted before the
 * first round, so this is a proof sheet rather than an illustration: a dotted
 * plate, a dot field that fades out before it can compete with text, and the
 * game's own glyph sitting on the fold. Everything decorative is a pseudo-element
 * or an `aria-hidden` span, so the region contributes exactly three strings to the
 * accessibility tree and no live-region behaviour of its own — §6.2's polite region
 * is the status strip's, and a placeholder that announced itself would talk over
 * "READY" and then over every mark the player makes.
 *
 * It replaces the stage rather than sitting beside it. The stage's own geometry is
 * the board's, so an empty one would be a 1-cell plate with a border around nothing;
 * and the region is already the one box whose height the reader can predict, so
 * holding its place here is what keeps the toolbar from jumping when a board lands.
 */
export interface BoardEmptyStateProps {
  readonly t: Copy
}

export function BoardEmptyState({ t }: BoardEmptyStateProps) {
  return (
    <div className="mg-board-empty" data-testid="board-empty">
      <div className="mg-board-empty__sheet">
        {/* The game, folded once: two diamonds and a rule, the smallest thing that
            is unmistakably this app without being a screenshot of it. */}
        <p className="mg-board-empty__glyph" aria-hidden="true">
          <span className="mg-board-empty__mark">◆</span>
          <span className="mg-board-empty__fold" />
        </p>
        <h2 className="mg-board-empty__title">{t.board.empty.title}</h2>
        <p className="mg-board-empty__body">{t.board.empty.body}</p>
        <p className="mg-board-empty__hint">{t.board.empty.hint}</p>
      </div>
    </div>
  )
}
