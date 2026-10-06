/**
 * The game picker: the app's front door. Two games as peers, presented as a
 * choice between games rather than a form. Cards are plain buttons — the
 * whole card is the hit area — and the `selected` prop turns a card's ring
 * on so a returning player sees where they were.
 *
 * The copy object mirrors `src/ui/copy.ts`'s shape (exhaustive `en`, full
 * `zhCN` sibling) so the wiring lane can lift it into the central dictionary
 * without restructuring. Presentational only: props in, callbacks out, no
 * store, no inward imports.
 */

export type GameId = 'minegram' | 'starbattle'

export interface GameStats {
  readonly roundsPlayed: number
  readonly bestStreak: number
}

export interface GamePickerProps {
  readonly locale: 'en' | 'zh'
  readonly selected: GameId | null
  readonly onSelect: (id: GameId) => void
  /** Best-effort progress per game; the cards look right when it is absent or all zeros. */
  readonly stats?: Record<GameId, GameStats>
}

interface PickerCopy {
  readonly title: string
  readonly games: Record<GameId, { readonly name: string; readonly blurb: string }>
  readonly stats: {
    readonly rounds: string
    readonly bestStreak: string
    readonly unplayed: string
  }
}

const en: PickerCopy = {
  title: 'Choose a game',
  games: {
    minegram: {
      name: 'Minegram',
      blurb: 'Mark the mines to match the run clues, one line at a time.',
    },
    starbattle: {
      name: 'Star Battle',
      blurb: 'One star in every row, column and colour. No two stars may touch.',
    },
  },
  stats: {
    rounds: '{count} rounds played',
    bestStreak: 'Best streak {count}',
    unplayed: 'Not played yet',
  },
}

const zhCN: PickerCopy = {
  title: '选择游戏',
  games: {
    minegram: {
      name: 'Minegram',
      blurb: '根据每行每列的数字提示标出地雷。',
    },
    starbattle: {
      name: '星战',
      blurb: '每一行、每一列、每种颜色各放一颗星，星与星不能相邻。',
    },
  },
  stats: {
    rounds: '已玩 {count} 局',
    bestStreak: '最长连胜 {count}',
    unplayed: '还没玩过',
  },
}

export function getPickerCopy(locale: 'en' | 'zh'): PickerCopy {
  return locale === 'zh' ? zhCN : en
}

/** The two games, in display order — the picker's contract with the wiring lane. */
export const GAME_IDS: readonly GameId[] = ['minegram', 'starbattle']

function fill(template: string, vars: Record<string, number>): string {
  return template.replace(/\{(\w+)\}/g, (raw, name: string) =>
    name in vars ? String(vars[name]) : raw,
  )
}

export function GamePicker({ locale, selected, onSelect, stats }: GamePickerProps) {
  const copy = getPickerCopy(locale)
  return (
    <div className="mg-picker" data-testid="game-picker">
      <h1 className="mg-picker__title">{copy.title}</h1>
      <div className="mg-picker__cards">
        {GAME_IDS.map((id) => {
          const game = copy.games[id]
          const played = stats?.[id] ?? null
          const hasRecord = played !== null && (played.roundsPlayed > 0 || played.bestStreak > 0)
          return (
            <button
              key={id}
              type="button"
              className="mg-picker__card"
              data-game={id}
              data-testid={`picker-${id}`}
              data-selected={selected === id ? 'true' : undefined}
              aria-pressed={selected === id}
              onClick={() => {
                onSelect(id)
              }}
            >
              <span className="mg-picker__name">{game.name}</span>
              <span className="mg-picker__blurb">{game.blurb}</span>
              {hasRecord ? (
                <span className="mg-picker__stats" data-empty="false">
                  <span>{fill(copy.stats.rounds, { count: played.roundsPlayed })}</span>
                  {played.bestStreak > 0 ? (
                    <span>{fill(copy.stats.bestStreak, { count: played.bestStreak })}</span>
                  ) : null}
                </span>
              ) : (
                <span className="mg-picker__stats" data-empty="true">
                  <span>{copy.stats.unplayed}</span>
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
