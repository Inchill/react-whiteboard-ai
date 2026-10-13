# Drawing quality tests

Two test sets measure how well diagrams come out. Both write an HTML report to `eval/out/`
(git-ignored) with every drawing and its numbers; open it in a browser.

## Layout benchmark: `pnpm eval:layout`

Lays out the fixed diagram structures in [`cases/diagrams.ts`](./cases/diagrams.ts) with
`add_diagram`'s auto layout, without calling a model, and compares each with
[`baseline.json`](./baseline.json). Use it while changing the layout code:

```bash
pnpm eval:layout            # measure and compare with the baseline
pnpm eval:layout --update   # accept the results as the new baseline (commit baseline.json)
pnpm eval:layout --check    # fail when any case scores lower than its baseline
```

Several cases are real model output for the prompts below, so improving them improves what users see.

## Model eval: `pnpm eval:model`

Sends each prompt in [`cases/prompts.ts`](./cases/prompts.ts) to the model configured in
`.env.local` (`AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL`), runs its tool calls the way the demo does
(errors go back to the model, at most 4 rounds) and records:

- **Content**: the share of expected boxes and links that are on the board. Links can only be
  checked when the model used `add_diagram`.
- **Layout**: the same score as the benchmark.
- **Rounds, time and tokens** per prompt.

```bash
pnpm eval:model                    # every prompt once
pnpm eval:model --case er,login    # some prompts
pnpm eval:model --runs 3           # each prompt three times; results vary between runs
pnpm eval:model --thinking         # with reasoning on
```

It calls the real model, so it costs tokens and takes a while. Compare reports between models, or
before and after a prompt change.

## Layout score

[`metrics.ts`](./metrics.ts) measures a drawing from its shapes alone and scores it out of 100:

| Problem | Penalty |
| --- | --- |
| Two edges crossing | 8 each |
| An edge running through a box | 10 each |
| An edge label overlapping another label, a box or an edge | 6 each |
| Parallel edges closer than 8 units over more than 10 units | 4 each |
| More than 2 turns per edge on average | 5 per extra turn |
