import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { loadWorkMarkdown } from '../lib/workIndex';

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
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      ) : null}
    </div>
  );
}
