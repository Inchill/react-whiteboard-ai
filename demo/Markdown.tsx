import { memo } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const plugins = [remarkGfm];

/** react-markdown hands each component its syntax-tree node; keep it off the DOM element. */
function withoutNode<P extends { node?: unknown }>(props: P): Omit<P, 'node'> {
    const rest = { ...props };
    delete rest.node;
    return rest;
}

const components: Components = {
    // Links open beside the board instead of replacing it.
    a: (props) => <a {...withoutNode(props)} target="_blank" rel="noreferrer noopener" />,
    // Wide tables scroll inside the panel rather than stretching it.
    table: (props) => (
        <div className="md-table">
            <table {...withoutNode(props)} />
        </div>
    ),
};

type MarkdownProps = { text: string; className?: string };

/** The model's reply rendered as Markdown (GFM: tables, lists, strikethrough, task lists). */
export const Markdown = memo(function Markdown({ text, className }: MarkdownProps) {
    return (
        <div className={className ? `md ${className}` : 'md'}>
            <ReactMarkdown remarkPlugins={plugins} components={components}>
                {text}
            </ReactMarkdown>
        </div>
    );
});

/** The reply as one plain line, for places that show only a glimpse of it. */
export function plainText(markdown: string): string {
    return markdown
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/^\s*\|?\s*:?-{2,}.*$/gm, ' ')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')
        .replace(/(\*\*|__|~~|`)/g, '')
        .replace(/\|/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
