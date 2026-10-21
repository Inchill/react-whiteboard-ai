# react-whiteboard-ai

[English](./README.md) | 简体中文

**[在线体验](https://inchill.github.io/react-whiteboard-ai/)**：填入你自己的 API key 即可使用（Claude、DeepSeek、OpenAI 兼容网关等），页面支持中文和英文。

让大模型读取并操作 [`@inchill/react-whiteboard`](https://github.com/Inchill/react-whiteboard) 白板：自动排版的流程图和架构图、手绘风格的线稿，以及普通的图形编辑。

这个包只提供白板和模型之间需要的几样东西：

- **上下文**：`describeBoard()` 把白板转成模型容易理解的紧凑 JSON。
- **工具**：五个以 JSON Schema 描述的工具，可直接用于 Anthropic 或 OpenAI 风格的工具调用，并附带一段讲解它们的系统提示词。
- **校验**：每次工具调用都会被检查。错误会带上字段路径返回，模型可以在下一轮自行修正。
- **执行**：模型的一轮操作对应 **一步撤销**，用户按一次 Ctrl+Z 就能全部撤回。

它从不调用模型，也接触不到 API key。请求由你自己的代码发出，用哪家模型都可以。白板核心库保持不变：不新增依赖，也不包含任何 AI 代码。

> 状态：早期版本（0.1），API 仍可能调整。

## 工具

| 工具 | 作用 |
| --- | --- |
| `add_diagram` | 用箭头连接的方框：流程图、架构图和分层图、组织架构图、树、状态机、流水线。模型只需给出节点、分层和连线，布局、方框尺寸、配色和箭头走线都是自动的 |
| `draw_sketch` | 带曲线的线稿：角色、动物、头像、植物、物品。模型先规划各个部位，再给出点或 SVG 路径，最终变成带压感的手绘笔迹 |
| `add_shapes` | 添加矩形、椭圆、三角形、文字，以及直线和箭头：直线、折线（`via` 拐点）或曲线 |
| `update_shapes` | 按 id 移动（`dx`/`dy`，任何图形都可以）、调整大小、修改样式、重新走线（`via`、`curved`）或修改文字 |
| `delete_shapes` | 按 id 删除 |

模型没有给坐标时，新内容会放在白板现有内容的右侧。新内容如果会和已有图形重叠，会作为一个整体被挪到空白处；标注类内容（框里的文字、圈住一组图形的高亮、端点落在某个图形上的箭头）则保持在模型指定的位置。

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

- **分行**：给了 `layer` 名称时，每一层是一行，并带有标注层名的色带，按首次出现的顺序排列；没给时按箭头方向分行。`direction: "right"` 改为从左到右排列，适合流水线和时间线。
- **箭头**：每条连线都是一个箭头，通过 `via` 拐点直角转弯，因此可以作为一个图形整体选中、移动和删除。跨行的箭头会绕开方框；两行之间多对多的连线共用一条总线；同一行内的连线和指回上方的连线（循环、重试）各自单独走线。
- **形状**：`shape: "ellipse"` 用于流程的开始和结束节点。"是" / "否" 这类连线标签会贴在箭头旁边。

工具结果会把每个节点 id 映射到为它画出的方框（`nodes: { gw: "s12", … }`），方便模型在之后的轮次修改这张图。上限：60 个节点，120 条连线。

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

- **先规划**：模型先写出 `subject`（画的是什么、视角、姿态），再给每个部位一个框，最后才写笔画，每一笔都标明所属部位。从另一个部位长出来的部位用 `on` 指明（尾巴 `on` 身体，耳朵 `on` 头）。工具会检查每一笔是否落在所属部位的框附近、每个部位是否都画了、带 `on` 的部位是否靠近它所依附的部位。小的缝隙（比如头画得比身体高了几个单位）会在绘制时自动合上：这个部位会移过去贴合，连同长在它上面或里面的东西（耳朵、眼睛）一起移动，工具结果会告诉模型移动了什么。偏差很大时（比如尾巴横穿脸部，或离身体很远），调用会失败并指出具体是哪一笔、在什么位置，模型在下一轮修正。对于没有推理模式的模型，先规划布局再写坐标尤其重要。
- **线条**：一笔要么是线条经过的 `points`，要么是 `d` 中的 SVG 路径数据。用点时，线条会平滑地穿过每个点（向心 Catmull-Rom 样条，不会打结或冲过头），`closed: true` 构成闭合线条。模型沿轮廓放点远比写贝塞尔控制点可靠，所以点适合身体、头、尾巴和叶子；`d` 适合圆、直线和精确图形，支持所有 SVG 路径命令：`M L H V C S Q T A Z`，绝对坐标和相对坐标均可。
- **坐标**：所有坐标都写在线稿自己的框里（默认 100 × 100，y 向下），再按比例缩放，使最长边在白板上等于 `size`。
- **笔画**：每条线（`d` 中每个 `M`）变成一笔笔迹，带有自然的手绘感：两端更细、略有抖动，闭合线条的首尾会稍稍重叠。这些变化由路径计算出的种子决定，同样的输入总会画出同样的结果。
- **结果**：产物是普通的笔迹图形，用户可以像对待自己画的笔画一样移动、改色或擦除。

它只画线，不做填充。系统提示词里通过一个完整示例讲解了画法，但画得好不好仍取决于模型；推理模型（或 demo 里的「深度思考」开关）画得明显更好。单独使用 `sketchToShapes` 时不需要 `subject` 和 `parts`。

## 安装

```bash
pnpm add @inchill/react-whiteboard-ai @inchill/react-whiteboard
```

需要 React 18 或更高版本，以及 `@inchill/react-whiteboard` 1.1 或更高版本（用于折线和曲线箭头）。

## 使用

模型的一轮操作是这样的：

1. 把白板（`describe()`）、工具和你的提示词发给模型。
2. 用 `execute()` 执行它的工具调用。这些改动作为一步撤销落到白板上。
3. 把每个结果作为 `tool_result` 发回去。无效的调用会带着错误返回，模型通常会在下一轮修正。
4. 模型不再调用工具、直接回答时结束。

浏览器端：

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
            const message = await res.json(); // Anthropic Messages API 的响应
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

服务端（以 Anthropic SDK 为例）：

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

**其他模型服务**

- **DeepSeek、千问、智谱、豆包**等都提供 Anthropic 兼容接口（见[连接模型](#连接模型)）。代码不变，换成对应的 `baseURL`、key 和模型名即可。
- **OpenAI 兼容接口**使用 `toOpenAITools()`。把每个调用的 `function.arguments` 解析成 JSON 后再作为 `input` 传入。

给模型留足输出空间：一张图或一幅线稿是很大的工具输入，推理模型还会在思考上消耗 token。`max_tokens` 设为 16000 左右比较稳妥。

不用 React 时，`createWhiteboardAgent(ref)` 返回同样的 `{ describe, execute }`。

## API

| 导出 | |
| --- | --- |
| `useWhiteboardAI(ref)` | React hook → `{ describe, execute }` |
| `createWhiteboardAgent(ref \| () => handle)` | 同上，不依赖 React |
| `describeBoard(shapes, { maxShapes })` | 白板 → 给模型的 JSON |
| `buildSystemPrompt({ extra })` | 讲解白板和工具的系统提示词 |
| `TOOL_DEFINITIONS`、`toAnthropicTools()`、`toOpenAITools()` | 工具定义 |
| `executeToolCalls(shapes, calls)` | 纯函数：校验并执行，返回新的图形列表和每个调用的结果 |
| `formatToolResult(result)` | 作为工具结果发回给模型的简短文本 |
| `parseOperation(name, input)` | 校验单个工具调用 |
| `applyOperations(shapes, ops)` | 纯函数：执行已校验的操作 |
| `layoutDiagram(input, { origin })` | 纯函数：把节点加箭头的图排版成白板图形，不需要模型 |
| `sketchToShapes(input, { origin, seed })` | 纯函数：点或 SVG 路径 → 手绘笔迹，不需要模型 |
| `smoothPath(points, closed)` | 穿过一组点的平滑线条的 SVG 路径数据 |
| `joinParts(input)` | `sketchToShapes` 为贴合部位所做的移动 |
| `parsePath(d)`、`samplePath(subpath, step)` | SVG 路径数据 → 子路径 → 等距采样点 |
| `LIMITS`、`DEFAULTS`、`DIAGRAM_STYLE`、`SKETCH_DEFAULTS` | 上限和默认样式 |

`layoutDiagram` 和 `sketchToShapes` 也可以单独使用，比如把数据或 SVG 图标转成可编辑的白板图形：

```ts
const { shapes } = layoutDiagram({ nodes, edges }, { origin: { x: 0, y: 0 } });
board.current?.setShapes([...board.current.getShapes(), ...shapes]);
```

## Demo

```bash
pnpm install
pnpm dev
```

demo 是一块带聊天面板的白板，界面有中文和英文（默认跟随浏览器语言，输入框下方的开关可以切换）。它展示了：

- **示例指令**：按工具擅长的方向分为手绘、结构图、布局和编辑（修改已有内容）。点一下就会发给模型，模型会用指令的语言回复并标注图形。
- **流式回复**：可以看到模型边写边出的文字、可折叠的思考过程，以及已经写好了多少个图形。一轮结束后，这一轮的图形作为一步撤销落到白板上。每个工具调用都会列出简短说明，以及退回给模型的校验错误。
- **深度思考**：打开或关闭模型推理的开关。关闭更快；打开时线稿和复杂的图画得更好。
- **停止**：取消当前请求。

### 连接模型

点击面板顶部的 **连接模型**，填写接口地址、接口格式、API key 和模型。支持两种格式：

- **Anthropic 消息**（`…/v1/messages`）：Claude，以及 DeepSeek、千问、智谱、豆包等的 Anthropic 兼容接口。
- **OpenAI 兼容的 Chat Completions**（`…/chat/completions`）：大多数公司网关和自建模型网关提供的格式。对话和工具会按这种格式发送，流式回复（文字、工具调用，以及作为思考过程的 `reasoning_content`）会被转换回来，其余功能完全一样。这种格式没有统一的推理开关，所以「深度思考」在这里不起作用。

接口地址一栏会给出一些建议：

| 服务 | 接口地址 |
| --- | --- |
| DeepSeek | `https://api.deepseek.com/anthropic` |
| 千问（阿里云百炼） | `https://dashscope.aliyuncs.com/apps/anthropic` |
| 智谱 | `https://open.bigmodel.cn/api/anthropic` |
| 豆包（火山方舟） | `https://ark.cn-beijing.volces.com/api/compatible` |
| Claude | `https://api.anthropic.com` |

接口也可以是任何其他兼容服务、公司网关或你自己的代理：输入地址，选好格式，再点「添加到常用接口」，就能以自己起的名字保存在列表里。它保存在当前浏览器中（只存地址、名称和格式，不存 key），也可以再从列表删除。以 `/chat/completions` 结尾的地址会自动选择 OpenAI 格式。模型名称变化很快，请以各服务的文档为准。Anthropic 格式下，key 会同时通过 `x-api-key` 和 `Authorization: Bearer` 发送（发给 Anthropic 时除外），因为各兼容服务读取的位置不同；OpenAI 格式下通过 `Authorization: Bearer` 发送。「深度思考」开关会显式发送 `thinking` 的开启或关闭，因为各服务的模型默认是否思考并不一致；如果服务拒绝了这个参数，会去掉它重试一次。设置默认只保留在当前标签页，勾选「在这个浏览器里记住」则保存在浏览器中。

在 `pnpm dev` 下，请求经过 Vite 开发服务器里的一个小代理转发，回复以流的形式传回。代理从不记录或保存 key，每个请求只打印一行耗时和事件计数，不含任何内容。

也可以在 `.env.local` 中配置模型（复制 `.env.example`），这样就不必在页面上填写。页面上填写的设置优先。

| 变量 | |
| --- | --- |
| `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL` | 接口地址、key 和模型 |
| `AI_FORMAT` | OpenAI 兼容接口填 `openai`，默认为 Anthropic 消息格式 |
| `AI_THINKING` | 填 `on` 时默认开启思考，页面上的开关会覆盖它 |
| `AI_MAX_TOKENS` | 默认 16000，思考也计入其中 |

旧的 `DEEPSEEK_API_KEY` 或 `ANTHROPIC_API_KEY`（以及用于二选一的 `AI_PROVIDER`）仍然可用。

在 shell 中导出的变量优先于 `.env.local`。

### 部署到 GitHub Pages

```bash
pnpm build:demo     # 静态文件输出到 dist-demo
pnpm preview:demo   # 本地预览构建结果
```

`dist-demo` 可以放在任何静态托管上，任意子路径都能用。静态托管没有服务器可以转发请求，所以部署后的页面会直接从访问者的浏览器调用模型，使用他们自己填写的 key，key 不会离开他们的浏览器。

- **Claude** 允许浏览器直接调用（页面会发送所需的授权请求头）。
- **其他服务**：是否接受网页直接调用由各服务决定。如果被拒绝（CORS 错误），页面会给出提示，访问者可以填写自己的代理作为接口地址。
- **公司网关**：访问者的浏览器需要能访问到网关（内部网关只能在公司网络内访问），并且网关需要允许来自页面所在域名的调用。否则请在本地运行 `pnpm dev`，由开发服务器发起调用。

仓库通过 `.github/workflows/deploy.yml` 发布：每次推送到 `main` 都会运行 lint、类型检查和测试，构建 `dist-demo` 并部署到 GitHub Pages；也可以在 Actions 页面手动运行。检查未通过的 demo 不会被发布。`.env.local` 只用于本地开发：静态构建从不读取 `.env` 文件，页面没有任何访问开发服务器的代码路径，工作流也会拒绝发布引用了其中任何一个的页面。

一次性设置：在仓库设置的 **Pages → Build and deployment → Source** 中选择 **GitHub Actions**。之后页面地址为 `https://<owner>.github.io/react-whiteboard-ai/`。

## 开发

需要 Node 24 或更高版本，以及 pnpm 10。

| 脚本 | |
| --- | --- |
| `pnpm dev` | 带本地模型代理的 demo |
| `pnpm build` | 构建库到 `dist`（ES 模块和类型声明） |
| `pnpm build:demo` / `pnpm preview:demo` | 构建静态 demo 到 `dist-demo` / 预览 |
| `pnpm test` / `pnpm test:watch` | Vitest |
| `pnpm lint`、`pnpm typecheck` | ESLint、TypeScript |
| `pnpm eval:layout` | 布局基准：排版一组固定的图，按交叉、重叠和间距与基线对比打分（不需要模型） |
| `pnpm eval:model` | 模型评测：把测试指令发给 `.env.local` 中配置的模型，从内容、布局、轮数、耗时和 token 几个方面打分 |

测试集和评分方式见 [eval/README.md](./eval/README.md)。

## 许可证

MIT
