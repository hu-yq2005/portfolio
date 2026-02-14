import { isValidElement, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadWorkMarkdown } from '../lib/workIndex';
import ScreenTimeClock from '../components/ScreenTimeClock';

function childrenToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(childrenToText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: unknown };
    return childrenToText(props.children);
  }
  return '';
}

function isScreenTimeClockToken(text: string): boolean {
  const t = text.trim();
  return t === '#screen_time_clock' || t === 'screen_time_clock';
}

export default function Work() {
  const { slug } = useParams();
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    loadWorkMarkdown(slug)
      .then((text) => {
        setMarkdown(text);
        setError(null);
      })
      .catch((err: unknown) => {
        setMarkdown(null);
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [slug]);

  return (
    <div className="stack">
      <div className="breadcrumb">
        <Link to="/">Home</Link>
        <span className="muted">/</span>
        <span>Work</span>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {!markdown && !error ? <p className="muted">Loading…</p> : null}

      {markdown ? (
        <article className="prose">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: (props) => {
                const text = childrenToText(props.children);
                if (isScreenTimeClockToken(text)) return <ScreenTimeClock />;
                return <p>{props.children}</p>;
              },
              h1: (props) => {
                const text = childrenToText(props.children);
                if (isScreenTimeClockToken(text)) return <ScreenTimeClock />;
                return <h1>{props.children}</h1>;
              },
              h2: (props) => {
                const text = childrenToText(props.children);
                if (isScreenTimeClockToken(text)) return <ScreenTimeClock />;
                return <h2>{props.children}</h2>;
              },
              h3: (props) => {
                const text = childrenToText(props.children);
                if (isScreenTimeClockToken(text)) return <ScreenTimeClock />;
                return <h3>{props.children}</h3>;
              },
            }}
          >
            {markdown}
          </ReactMarkdown>
        </article>
      ) : null}
    </div>
  );
}
