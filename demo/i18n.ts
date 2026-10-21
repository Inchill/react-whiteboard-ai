import { useSyncExternalStore } from 'react';

export type Lang = 'zh' | 'en';

const STORAGE_KEY = 'react-whiteboard-ai-demo:lang';

/** The saved choice, else the browser's language: Chinese for zh-*, English for everything else. */
function initialLang(): Lang {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved === 'zh' || saved === 'en') return saved;
    } catch {
        /* storage unavailable */
    }
    const langs = typeof navigator !== 'undefined' ? (navigator.languages?.length ? navigator.languages : [navigator.language]) : [];
    return langs.some((l) => /^zh\b/i.test(l ?? '')) ? 'zh' : 'en';
}

let current: Lang = initialLang();
const listeners = new Set<() => void>();

function applyToDocument(lang: Lang) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    document.title = STRINGS[lang].pageTitle;
}

export const getLang = () => current;

export function setLang(lang: Lang) {
    if (lang === current) return;
    current = lang;
    try {
        localStorage.setItem(STORAGE_KEY, lang);
    } catch {
        /* storage unavailable: the choice lasts for this page only */
    }
    applyToDocument(lang);
    listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
    listeners.add(l);
    return () => listeners.delete(l);
};

export const useLang = () => useSyncExternalStore(subscribe, getLang, getLang);
export const useT = () => STRINGS[useLang()];

const zh = {
    pageTitle: 'react-whiteboard-ai — 让 AI 在白板上画图',
    switchTo: 'English',
    switchLabel: 'Switch to English',

    board: '白板',
    viewSource: '在 GitHub 查看源码',
    assistant: 'AI 助手',
    openAssistant: (busy: boolean, unseen: boolean) => `展开 AI 助手${busy ? '（正在回复）' : unseen ? '（有新消息）' : ''}`,
    closeAssistant: '收起 AI 助手',
    close: '收起',
    sheetUp: '展开对话',
    sheetDown: '收起对话',
    sheetIdle: '告诉 AI 要画什么',
    connect: '连接模型',
    /** The header button, where space is tight. */
    connectShort: '连接模型',
    log: '操作记录',
    emptyTitle: '告诉我要在白板上画什么',
    emptyExamples: '比如“画一个三步的注册流程”“把所有框改成蓝色”。',
    emptyCanAsk: '也可以直接点下面的示例。',
    emptyConnect: '先在右上角连接模型（任何 Anthropic 或 OpenAI 兼容的接口，包括公司网关），再输入指令或点下面的示例。',
    waiting: '等待模型回复',
    exampleGroups: '示例分类',
    placeholder: '要画什么？',
    placeholderOff: '先连接模型，才能用文字指挥',
    composerLabel: '给 AI 的指令',
    thinkTitle: '让模型先推理再动手。更适合复杂指令，但会慢很多。',
    think: '深度思考',
    stop: '停止',
    send: '发送',
    sendTitle: '发送（回车）',
    composerHint: (undo: string) => `回车发送，Shift+回车换行 · AI 每轮修改算一步，${undo} 整体撤回`,
    exampleTag: '示例',
    returnedErrors: '退回给模型的错误',
    showInput: '查看参数',

    keyRejected: (status: number, detail: string) => `模型拒绝了这个 API key（${status}）：${detail}`,
    requestFailed: (detail: string) => `请求失败：${detail}`,
    checkKey: '检查 API key',
    truncated: '模型的输出达到长度上限，回答被截断了。',
    allThinking: '模型把输出额度都用在了思考上，还没来得及画。可以把要求说得更具体一些，或者换一个思考更少的模型（比如 deepseek-flash）。',
    noReply: '模型这一轮没有回复，也没有修改白板。',
    stopped: '已停止。这一轮还没写完的修改没有画到白板上。',
    unreachable: (service: string) => `浏览器连不上 ${service}。这个服务可能不允许网页直接调用（跨域限制），可以在设置里填写一个代理的接口地址；也请检查网络连接。`,
    openSettings: '打开设置',
    failed: (message: string) => `出错了：${message}`,

    pending: {
        add_shapes: ['正在添加图形', '个'],
        add_diagram: ['正在描述图的结构', '个节点'],
        draw_sketch: ['正在构思线稿', '笔'],
        update_shapes: ['正在修改图形', '处'],
        delete_shapes: ['正在删除图形', '个'],
    } as Record<string, [string, string]>,
    pendingOther: (name: string): [string, string] => [`正在调用 ${name}`, '项'],
    pendingCount: (n: number, unit: string) => `已写好 ${n} ${unit}，写完后一起画到白板上`,
    pendingStart: '正在写参数',
    thinking: (s: number) => `正在思考，已 ${s} 秒`,
    thought: (s: number) => `思考了 ${s} 秒`,
    thoughtUntimed: '思考过程',
    expand: '展开',
    collapse: '收起',

    settingsIntro: 'Anthropic 消息格式或 OpenAI 兼容格式的接口都能用：Claude、DeepSeek、千问、智谱、豆包，也可以是公司内部网关。',
    format: '接口格式',
    formatAnthropic: 'Anthropic 消息',
    formatOpenAI: 'OpenAI 兼容',
    formatHintOpenAI: '请求发到 …/chat/completions。这种格式没有统一的推理开关，「深度思考」不起作用，模型自己推理时仍会显示思考过程。',
    formatHintAnthropic: '请求发到 …/v1/messages。不确定的话看网关文档：路径里有 chat/completions 的选 OpenAI 兼容。',
    keyKept: '已保存，留空则继续使用',
    keyPlaceholder: '这个接口的 key',
    model: '模型',
    modelPlaceholderOpenAI: '以网关里的模型名为准，如 gpt-5、qwen-max',
    modelPlaceholder: '如 deepseek-v4-pro、glm-5.2',
    remember: '在这个浏览器里记住',
    remembered: 'key 会留在这个浏览器里，下次打开还能用。',
    tabOnly: 'key 只留在这个标签页，关掉就清除。',
    direct: (service: string | null) => `请求从你的浏览器直接发到 ${service ?? '这个接口'}，不经过其他服务器。`,
    save: '保存',
    cancel: '取消',
    clear: '清除',

    endpoint: '接口地址',
    endpointPlaceholder: '选一个，或输入任意地址（如公司网关）',
    commonEndpoints: '常用接口',
    removeEndpoint: (name: string) => `删除 ${name}`,
    removeFromList: '从列表删除',
    endpointHint: '列表里没有？直接在上面输入地址，比如公司网关，再「添加到常用接口」。',
    addEndpoint: '＋ 添加到常用接口',
    endpointName: '名称，如 Kimi',
    endpointNameLabel: '新接口的名称',
    add: '添加',
};

export type Strings = typeof zh;

const en: Strings = {
    pageTitle: 'react-whiteboard-ai — let AI draw on a whiteboard',
    switchTo: '中文',
    switchLabel: '切换到中文',

    board: 'Whiteboard',
    viewSource: 'View source on GitHub',
    assistant: 'AI assistant',
    openAssistant: (busy, unseen) => `Open the AI assistant${busy ? ' (replying)' : unseen ? ' (new messages)' : ''}`,
    closeAssistant: 'Hide the AI assistant',
    close: 'Hide',
    sheetUp: 'Show the chat',
    sheetDown: 'Hide the chat',
    sheetIdle: 'Tell the AI what to draw',
    connect: 'Connect a model',
    connectShort: 'Connect',
    log: 'Activity',
    emptyTitle: 'Tell me what to draw on the board',
    emptyExamples: 'For example "draw a three-step sign-up flow" or "make every box blue". ',
    emptyCanAsk: 'Or pick one of the examples below.',
    emptyConnect: 'Connect a model at the top right first (any Anthropic or OpenAI-compatible endpoint, including a company gateway), then type a request or pick an example below.',
    waiting: 'Waiting for the model',
    exampleGroups: 'Example categories',
    placeholder: 'What should I draw?',
    placeholderOff: 'Connect a model to give instructions',
    composerLabel: 'Instruction for the AI',
    thinkTitle: 'Let the model reason before it draws. Better for complex requests, but much slower.',
    think: 'Deep thinking',
    stop: 'Stop',
    send: 'Send',
    sendTitle: 'Send (Enter)',
    composerHint: (undo) => `Enter to send, Shift+Enter for a new line · Each AI turn is one step: ${undo} undoes it`,
    exampleTag: 'Example',
    returnedErrors: 'Errors sent back to the model',
    showInput: 'Show input',

    keyRejected: (status, detail) => `The model rejected this API key (${status}): ${detail}`,
    requestFailed: (detail) => `Request failed: ${detail}`,
    checkKey: 'Check the API key',
    truncated: 'The model hit its output limit and the answer was cut off.',
    allThinking: 'The model spent its whole output budget on thinking before drawing anything. Try a more specific request, or a model that thinks less (such as deepseek-flash).',
    noReply: 'The model neither replied nor changed the board this round.',
    stopped: 'Stopped. Changes from this round that were not finished were not drawn.',
    unreachable: (service) => `The browser cannot reach ${service}. The service may not allow calls from web pages (CORS); you can enter a proxy address in the settings. Also check your network connection.`,
    openSettings: 'Open settings',
    failed: (message) => `Something went wrong: ${message}`,

    pending: {
        add_shapes: ['Adding shapes', 'shapes'],
        add_diagram: ['Describing the diagram', 'nodes'],
        draw_sketch: ['Planning a sketch', 'strokes'],
        update_shapes: ['Editing shapes', 'changes'],
        delete_shapes: ['Deleting shapes', 'shapes'],
    },
    pendingOther: (name) => [`Calling ${name}`, 'items'],
    pendingCount: (n, unit) => `${n} ${unit} written; all are drawn at once when done`,
    pendingStart: 'Writing the input',
    thinking: (s) => `Thinking, ${s} s`,
    thought: (s) => `Thought for ${s} s`,
    thoughtUntimed: 'Thinking',
    expand: 'Show',
    collapse: 'Hide',

    settingsIntro: 'Works with any endpoint in the Anthropic Messages or OpenAI-compatible format: Claude, DeepSeek, Qwen, GLM, Doubao, or a company gateway.',
    format: 'API format',
    formatAnthropic: 'Anthropic Messages',
    formatOpenAI: 'OpenAI-compatible',
    formatHintOpenAI: 'Requests go to …/chat/completions. This format has no common reasoning switch, so "Deep thinking" has no effect; a model that reasons on its own still shows its thinking.',
    formatHintAnthropic: 'Requests go to …/v1/messages. If unsure, check the gateway docs: a path with chat/completions means OpenAI-compatible.',
    keyKept: 'Saved; leave empty to keep using it',
    keyPlaceholder: 'Key for this endpoint',
    model: 'Model',
    modelPlaceholderOpenAI: 'As named by the gateway, e.g. gpt-5, qwen-max',
    modelPlaceholder: 'e.g. deepseek-v4-pro, glm-5.2',
    remember: 'Remember in this browser',
    remembered: 'The key stays in this browser for next time. ',
    tabOnly: 'The key stays in this tab only and is cleared when it closes. ',
    direct: (service) => `Requests go straight from your browser to ${service ?? 'this endpoint'}, through no other server.`,
    save: 'Save',
    cancel: 'Cancel',
    clear: 'Clear',

    endpoint: 'Endpoint',
    endpointPlaceholder: 'Pick one, or type any address (e.g. a company gateway)',
    commonEndpoints: 'Saved endpoints',
    removeEndpoint: (name) => `Remove ${name}`,
    removeFromList: 'Remove from the list',
    endpointHint: 'Not listed? Type the address above, such as a company gateway, then "Save this endpoint".',
    addEndpoint: '+ Save this endpoint',
    endpointName: 'Name, e.g. Kimi',
    endpointNameLabel: 'Name for the new endpoint',
    add: 'Save',
};

export const STRINGS: Record<Lang, Strings> = { zh, en };

applyToDocument(current);
