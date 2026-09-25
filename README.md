# Minegram

Minegram is a browser puzzle game about ordered mine runs. Each row and column is described by significant run lengths, and every generated board is proven to have exactly one solution.

The playable implementation is in progress. See [`plan/PLAN.md`](plan/PLAN.md) for the product contract, generation algorithm, delivery phases, and verification budget.

## Planned features

- Custom board dimensions and mine density
- Uniquely solvable random puzzles generated in a Web Worker
- Difficulty based on required logical guesses
- Mine/blank marking, corrections, scoring, drag painting, and keyboard controls
- Responsive, accessible interface
- GitHub Pages deployment

## Phase 0 foundation

The repository now contains a Node 24+ React, TypeScript, and Vite foundation. The placeholder shell is intentionally limited to Phase 0; game algorithms and visual design are not implemented yet.

Install dependencies and run the reproducible checks with:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The Vite production base path is `/minegram/`, and the GitHub Pages workflow uploads the generated `dist/` directory.
