export type SystemPromptOptions = {
    /** Extra instructions appended at the end, e.g. the product's tone or domain. */
    extra?: string;
};

/**
 * A system prompt that explains the board model to an LLM. Pair it with `TOOL_DEFINITIONS`
 * and put `describeBoard(...)` output in the user message.
 */
export function buildSystemPrompt(options: SystemPromptOptions = {}): string {
    const lines = [
        'You can see and edit a whiteboard through tools.',
        '',
        'The board:',
        '- An infinite canvas in world units. x grows to the right, y grows downward.',
        '- The current board is given as JSON: `bounds` covers all content, `shapes` lists each shape in paint order (later ones are on top).',
        '- Each shape has an `id`, a `type` and its bounding box (x, y, w, h). Lines and arrows also have their end points; text has its content.',
        '- Freehand strokes (`pen`, `highlighter`) are summarized by their box only. You can move, recolor or delete them but not reshape them.',
        '- Colors are "ink" (follows the light or dark theme; use it by default) or hex colors. Good accents: #e03131 red, #f08c00 orange, #2f9e44 green, #1971c2 blue, #7048e8 violet.',
        '',
        'How to work:',
        '- Refer to existing shapes only by the ids you were given. Never invent ids.',
        '- Put new content next to existing content, with roughly 40 units of space, unless the user asks for a specific place.',
        '- Keep sizes consistent with what is already on the board. Typical text is 24 units; a typical box is 120–240 units wide.',
        '- Prefer one tool call with many shapes over many calls with one shape each.',
        '- If a tool result reports errors, fix only the failed items and try again.',
        '- When you are done, reply with one short sentence about what you changed.',
    ];
    if (options.extra) lines.push('', options.extra);
    return lines.join('\n');
}
