# react-whiteboard-ai

Let an LLM read and edit an [`@inchill/react-whiteboard`](https://github.com/Inchill/react-whiteboard) board.

The package gives you the pieces between the board and the model, and nothing else:

- **Context** — `describeBoard()` turns the board into compact JSON the model can reason about.
- **Tools** — `TOOL_DEFINITIONS` (JSON Schema), ready for Anthropic or OpenAI-style tool calling.
- **Validation** — every tool call is checked; errors come back with paths so the model can fix them.
- **Execution** — one model turn becomes **one undo step**, so the user can take it all back with Ctrl+Z.

It never calls a model and never sees an API key. You send the request from your own backend, with any provider.

> Status: early (0.1). Hand-drawn sketching (`draw_sketch`) and annotations are next.

## Local preview

```bash
pnpm install
pnpm dev
```

The demo page has canned examples that run without an API key: each one is a model turn written exactly as a model would return it, so you can see the tool calls, the validation errors and the single-step undo.

To talk to a real model, copy `.env.example` to `.env.local`, set `ANTHROPIC_API_KEY`, and restart `pnpm dev`. The key stays in the local dev server and never reaches the browser.

## Install

```bash
pnpm add @inchill/react-whiteboard-ai @inchill/react-whiteboard
```

## Use

In the browser:

```tsx
import { useRef } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { useWhiteboardAI } from '@inchill/react-whiteboard-ai';

export function Board() {
    const board = useRef<WhiteboardHandle>(null);
    const ai = useWhiteboardAI(board);

    async function ask(prompt: string) {
        const res = await fetch('/api/whiteboard-ai', {
            method: 'POST',
            body: JSON.stringify({ prompt, board: ai.describe() }),
        });
        const { toolCalls } = await res.json(); // [{ id, name, input }]
        const results = ai.execute(toolCalls);   // applied as one undo step
        // Optionally send `results` back to the model for another round.
    }

    return <Whiteboard ref={board} />;
}
```

On your server (Anthropic SDK shown; any provider works):

```ts
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, toAnthropicTools } from '@inchill/react-whiteboard-ai';

const client = new Anthropic();

export async function handle({ prompt, board }) {
    const message = await client.messages.create({
        model: 'claude-opus-5-5',
        max_tokens: 4096,
        system: buildSystemPrompt(),
        tools: toAnthropicTools(),
        messages: [{ role: 'user', content: `Board:\n${JSON.stringify(board)}\n\n${prompt}` }],
    });
    const toolCalls = message.content
        .filter((b) => b.type === 'tool_use')
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));
    return { toolCalls };
}
```

For OpenAI-compatible APIs use `toOpenAITools()` and parse each call's `function.arguments` as JSON before passing it as `input`.

## Tools

| Tool | Does |
| --- | --- |
| `add_shapes` | Add rectangles, ellipses, triangles, lines, arrows and text |
| `update_shapes` | Move (`dx`/`dy`, any shape), resize, restyle or edit text by id |
| `delete_shapes` | Delete by id |

## API

| Export | |
| --- | --- |
| `useWhiteboardAI(ref)` | React hook → `{ describe, execute }` |
| `createWhiteboardAgent(ref \| () => handle)` | Same, without React |
| `describeBoard(shapes, { maxShapes })` | Board → JSON for the model |
| `executeToolCalls(shapes, calls)` | Pure: validate + apply, returns new shapes and per-call results |
| `applyOperations(shapes, ops)` | Pure: apply already-validated operations |
| `parseOperation(name, input)` | Validate one tool call |
| `formatToolResult(result)` | Short text to return to the model as the tool result |
| `TOOL_DEFINITIONS`, `toAnthropicTools()`, `toOpenAITools()` | Tool schemas |
| `buildSystemPrompt({ extra })` | System prompt that explains the board |

## License

MIT
