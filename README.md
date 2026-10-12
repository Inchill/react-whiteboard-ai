# react-whiteboard-ai

Let an LLM read and draw on an [`@inchill/react-whiteboard`](https://github.com/Inchill/react-whiteboard) board: flowcharts and architecture diagrams with automatic layout, hand-drawn line sketches, and plain shape edits.

The package gives you the pieces between the board and the model, and nothing else:

- **Context**: `describeBoard()` turns the board into compact JSON the model can reason about.
- **Tools**: five tools as JSON Schema, ready for Anthropic or OpenAI-style tool calling, plus a system prompt that explains them.
- **Validation**: every tool call is checked. Errors come back with paths, so the model can fix them in the next round.
- **Execution**: one model turn becomes **one undo step**, so the user can take it all back with Ctrl+Z.

It never calls a model and never sees an API key. You send the request from your own code, with any provider. The core whiteboard stays as it is: no new dependencies and no AI code in it.

> Status: early (0.1). The API may still change.

## Tools

| Tool | Does |
| --- | --- |
| `add_diagram` | Boxes joined by arrows: flowcharts, architecture and layer diagrams, org charts, trees, state machines, pipelines. The model gives only nodes, layers and edges. Layout, box sizes, colors and arrow routing are automatic |
| `draw_sketch` | Line drawings with curves: characters, animals, avatars, plants, objects. The model plans the parts and gives points or SVG paths, which become hand-drawn pressure pen strokes |
| `add_shapes` | Add rectangles, ellipses, triangles, lines, arrows and text |
| `update_shapes` | Move (`dx`/`dy`, any shape), resize, restyle or edit text by id |
| `delete_shapes` | Delete by id |

Anything the model draws without coordinates is placed to the right of what is already on the board.

### `add_diagram`

```json
{
    "direction": "down",
    "nodes": [
        { "id": "web", "label": "Web", "layer": "客户端" },
        { "id": "app", "label": "App", "layer": "客户端" },
        { "id": "gw", "label": "API 网关", "layer": "接入层" },
        { "id": "order", "label": "订单服务", "layer": "服务层" },
        { "id": "user", "label": "用户服务", "layer": "服务层" },
        { "id": "db", "label": "MySQL", "layer": "数据层" }
    ],
    "edges": [
        { "from": "web", "to": "gw" },
        { "from": "app", "to": "gw" },
        { "from": "gw", "to": "order" },
        { "from": "gw", "to": "user" },
        { "from": "order", "to": "db" },
        { "from": "user", "to": "db", "style": "dashed" }
    ]
}
```

- **Rows**: with `layer` names, each layer is a row with a labeled band, in order of first use. Without them, rows follow the arrows. `direction: "right"` lays it out left to right, for pipelines and timelines.
- **Arrows**: arrows that skip rows are routed around boxes. Many-to-many links between two rows share a bus. Links within a row and links pointing back up (loops, retries) get their own routes.
- **Shapes**: `shape: "ellipse"` is for the start and end of a flow. Edge labels such as "是" / "否" sit on the arrow.

The tool result maps each node id to the box drawn for it (`nodes: { gw: "s12", … }`), so the model can edit the diagram in a later turn. Limits: 60 nodes, 120 edges.

### `draw_sketch`

```json
{
    "subject": "a smiling face, front view",
    "parts": [
        { "name": "face", "x": 12, "y": 12, "w": 76, "h": 80 },
        { "name": "eyes", "x": 30, "y": 44, "w": 40, "h": 12 },
        { "name": "mouth", "x": 36, "y": 66, "w": 28, "h": 12 }
    ],
    "strokes": [
        {
            "part": "face",
            "points": [[50, 12], [76, 20], [88, 46], [82, 76], [62, 91], [38, 91], [18, 76], [12, 46], [24, 20]],
            "closed": true,
            "width": 4
        },
        { "part": "eyes", "d": "M36 50 A4 4 0 1 1 36.1 50 M64 50 A4 4 0 1 1 64.1 50" },
        { "part": "mouth", "points": [[38, 70], [50, 77], [62, 70]] }
    ],
    "size": 240
}
```

- **Plan first**: the model states the `subject` (what it is, the view, the pose), then a box for each part, then the strokes, each tagged with its part. A part that grows from another names it in `on` (a tail `on` the body, an ear `on` the head). The tool checks that every stroke stays near its part's box, that every part gets drawn, and that each part with `on` is near the part it grows from. A small gap, such as a head drawn a few units above the body, is closed while drawing: the part moves to touch, taking along what is on it or inside it (ears, eyes), and the tool result tells the model what moved. When they disagree badly, for example a tail drawn across the face or far from the body, the call fails with the exact stroke and position, and the model fixes it in the next round. Planning the layout before writing coordinates matters most for models without a reasoning mode.
- **Lines**: a stroke is either `points` the line passes through or SVG path data in `d`. With points, the line runs smoothly through each one (centripetal Catmull-Rom, so it never loops or overshoots), and `closed: true` makes a loop. Models place points along an outline far more reliably than they write Bézier control points, so points suit bodies, heads, tails and leaves; `d` suits circles, straight lines and exact shapes, and every SVG path command works: `M L H V C S Q T A Z`, absolute and relative.
- **Coordinates**: everything is written in the drawing's own box (default 100 × 100, y down) and scaled so the longest side is `size` on the board.
- **Strokes**: each line (each `M` in `d`) becomes one pen stroke. The stroke gets a natural hand-drawn line: it is thinner at the ends, with a slight wobble, and closed loops overlap a little where they meet. The variation comes from a seed derived from the paths, so the same input always draws the same way.
- **Result**: the result is ordinary pen shapes, so users can move, recolor or erase them like their own strokes.

It draws lines only, with no fills. The system prompt teaches a drawing method with a worked example, but how good the picture is still depends on the model; reasoning models (or the demo's deep-thinking switch) draw noticeably better. `sketchToShapes` on its own does not need `subject` or `parts`.

## Install

```bash
pnpm add @inchill/react-whiteboard-ai @inchill/react-whiteboard
```

Requires React 18 or later and `@inchill/react-whiteboard` 1.0 or later.

## Use

A model turn goes like this:

1. Send the board (`describe()`), the tools and your prompt to the model.
2. Run its tool calls with `execute()`. They land on the board as one undo step.
3. Send each result back as a `tool_result`. Invalid calls come back with their errors, and the model usually fixes them in the next round.
4. Stop when the model answers without calling a tool.

In the browser:

```tsx
import { useRef } from 'react';
import { Whiteboard, type WhiteboardHandle } from '@inchill/react-whiteboard';
import { formatToolResult, useWhiteboardAI } from '@inchill/react-whiteboard-ai';

export function Board() {
    const board = useRef<WhiteboardHandle>(null);
    const ai = useWhiteboardAI(board);

    async function ask(prompt: string) {
        const messages: unknown[] = [{ role: 'user', content: `Board:\n${JSON.stringify(ai.describe())}\n\n${prompt}` }];
        for (let round = 0; round < 4; round++) {
            const res = await fetch('/api/whiteboard-ai', { method: 'POST', body: JSON.stringify({ messages }) });
            const message = await res.json(); // Anthropic Messages API response
            const calls = message.content.filter((b) => b.type === 'tool_use');
            if (!calls.length) break;

            const results = ai.execute(calls.map((b) => ({ id: b.id, name: b.name, input: b.input })));
            messages.push(
                { role: 'assistant', content: message.content },
                {
                    role: 'user',
                    content: results.map((r) => ({
                        type: 'tool_result',
                        tool_use_id: r.id,
                        content: formatToolResult(r),
                        is_error: !r.ok,
                    })),
                },
            );
        }
    }

    return <Whiteboard ref={board} />;
}
```

On your server (Anthropic SDK shown):

```ts
import Anthropic from '@anthropic-ai/sdk';
import { buildSystemPrompt, toAnthropicTools } from '@inchill/react-whiteboard-ai';

const client = new Anthropic();

export async function handle({ messages }) {
    return client.messages.create({
        model: 'claude-sonnet-5-5',
        max_tokens: 16000,
        system: buildSystemPrompt(),
        tools: toAnthropicTools(),
        messages,
    });
}
```

**Other providers**

- **DeepSeek, Qwen, GLM, Doubao** and others have Anthropic-compatible endpoints (see [Connect a model](#connect-a-model)). Use the same code with that `baseURL` and the service's key and model.
- **OpenAI-compatible APIs** use `toOpenAITools()`. Parse each call's `function.arguments` as JSON before passing it as `input`.

Give the model room to work: a diagram or sketch is a large tool input, and reasoning models also spend tokens on thinking. A `max_tokens` around 16000 is safe.

Without React, `createWhiteboardAgent(ref)` returns the same `{ describe, execute }`.

## API

| Export | |
| --- | --- |
| `useWhiteboardAI(ref)` | React hook → `{ describe, execute }` |
| `createWhiteboardAgent(ref \| () => handle)` | Same, without React |
| `describeBoard(shapes, { maxShapes })` | Board → JSON for the model |
| `buildSystemPrompt({ extra })` | System prompt that explains the board and the tools |
| `TOOL_DEFINITIONS`, `toAnthropicTools()`, `toOpenAITools()` | Tool schemas |
| `executeToolCalls(shapes, calls)` | Pure: validate and apply, returns new shapes and per-call results |
| `formatToolResult(result)` | Short text to send back to the model as the tool result |
| `parseOperation(name, input)` | Validate one tool call |
| `applyOperations(shapes, ops)` | Pure: apply already validated operations |
| `layoutDiagram(input, { origin })` | Pure: lay out a node-and-arrow diagram as board shapes, no model needed |
| `sketchToShapes(input, { origin, seed })` | Pure: points or SVG paths → hand-drawn pen strokes, no model needed |
| `smoothPath(points, closed)` | SVG path data for a smooth line through points |
| `joinParts(input)` | The moves `sketchToShapes` makes to join attached parts |
| `parsePath(d)`, `samplePath(subpath, step)` | SVG path data → subpaths → evenly spaced points |
| `LIMITS`, `DEFAULTS`, `DIAGRAM_STYLE`, `SKETCH_DEFAULTS` | Limits and default styles |

`layoutDiagram` and `sketchToShapes` are useful on their own, for example to turn data or an SVG icon into editable board shapes:

```ts
const { shapes } = layoutDiagram({ nodes, edges }, { origin: { x: 0, y: 0 } });
board.current?.setShapes([...board.current.getShapes(), ...shapes]);
```

## Demo

```bash
pnpm install
pnpm dev
```

The demo is a whiteboard with a chat panel. It shows:

- **Example prompts**, grouped by what the tools do well: 手绘 (sketches), 结构图 (diagrams), 布局 (layouts) and 编辑 (edits on what is already there). Clicking one sends it to the model.
- **Streaming replies**: you see the model's text as it writes it, its thinking (collapsible), and how many shapes it has written so far. When a round is complete, its shapes land on the board as one undo step. Each tool call is listed with a short summary, along with any validation errors sent back to the model.
- **Deep thinking**: a switch that turns the model's reasoning on or off. Off is faster. On draws better sketches and more complex diagrams.
- **Stop**: cancels the current request.

### Connect a model

Click **连接模型** in the panel header and fill in three fields: the endpoint, an API key and the model. Any service that speaks the Anthropic Messages format works, and the endpoint field suggests some:

| Service | Endpoint |
| --- | --- |
| DeepSeek | `https://api.deepseek.com/anthropic` |
| Qwen (Alibaba Cloud Model Studio) | `https://dashscope.aliyuncs.com/apps/anthropic` |
| GLM (Zhipu) | `https://open.bigmodel.cn/api/anthropic` |
| Doubao (Volcengine Ark) | `https://ark.cn-beijing.volces.com/api/compatible` |
| Claude | `https://api.anthropic.com` |

The endpoint can also be any other compatible service, gateway or your own proxy. Type its address and choose *添加到常用接口* to keep it in the list under a name of your own; it is stored in this browser (the address and name only, never the key) and can be removed from the list again. Model names change often, so check each service's documentation for current ones. The key is sent with both `x-api-key` and, except to Anthropic, `Authorization: Bearer`, since compatible services differ in which they read. The deep-thinking switch sends `thinking` enabled or disabled explicitly, because services differ in whether a model thinks by default; if a service rejects the request, it is retried once without it. Settings are kept in this tab only, or in the browser if you tick *在这个浏览器里记住*.

In `pnpm dev`, requests go through a small proxy in the Vite dev server, which forwards them and streams the reply back. The proxy never logs or stores keys. It prints one line per request with timing and event counts, never content.

You can also configure the model in `.env.local` (copy `.env.example`), so you do not have to enter it on the page. Settings entered on the page take precedence.

| Variable | |
| --- | --- |
| `AI_BASE_URL`, `AI_API_KEY`, `AI_MODEL` | Endpoint, key and model |
| `AI_THINKING` | `on` to think by default. The page switch overrides it |
| `AI_MAX_TOKENS` | Default 16000. Thinking counts toward it |

Older files with `DEEPSEEK_API_KEY` or `ANTHROPIC_API_KEY` (and `AI_PROVIDER` to choose between them) still work.

Variables exported in your shell take precedence over `.env.local`.

### Deploy to GitHub Pages

```bash
pnpm build:demo     # static files in dist-demo
pnpm preview:demo   # check the build locally
```

`dist-demo` works on any static host, at any sub-path. A static host has no server to proxy through, so the deployed page calls the model straight from the visitor's browser with the key they enter, and the key never leaves their browser.

- **Claude** allows browser calls (the page sends the required opt-in header).
- **Other services**: whether they accept calls from web pages is up to each one. If one refuses (a CORS error), the page says so, and visitors can enter a proxy of their own as the endpoint.

To publish from GitHub Actions:

1. Add `.github/workflows/deploy.yml`:

    ```yaml
    name: Deploy demo
    on:
      push:
        branches: [main]
      workflow_dispatch:
    permissions:
      contents: read
      pages: write
      id-token: write
    concurrency:
      group: pages
      cancel-in-progress: true
    jobs:
      deploy:
        runs-on: ubuntu-latest
        environment:
          name: github-pages
          url: ${{ steps.deployment.outputs.page_url }}
        steps:
          - uses: actions/checkout@v4
          - uses: pnpm/action-setup@v4
          - uses: actions/setup-node@v4
            with:
              node-version: 24
              cache: pnpm
          - run: pnpm install --frozen-lockfile
          - run: pnpm build:demo
          - uses: actions/upload-pages-artifact@v3
            with:
              path: dist-demo
          - id: deployment
            uses: actions/deploy-pages@v4
    ```

2. In the repository settings, under **Pages → Build and deployment → Source**, choose **GitHub Actions**.

## Development

Requires Node 24 or later and pnpm 10.

| Script | |
| --- | --- |
| `pnpm dev` | Demo with the local model proxy |
| `pnpm build` | Library build into `dist` (ES module and type declarations) |
| `pnpm build:demo` / `pnpm preview:demo` | Static demo into `dist-demo` / preview it |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm lint`, `pnpm typecheck` | ESLint, TypeScript |

## License

MIT
