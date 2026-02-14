import { FormEvent, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function isProbablyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function View() {
  const [url, setUrl] = useState<string>('');
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hint = useMemo(() => {
    return 'Example: https://raw.githubusercontent.com/<user>/<repo>/main/README.md';
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();

    if (!isProbablyUrl(url)) {
      setError('Please enter a valid http(s) URL.');
      setMarkdown(null);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`);
      }
      const text = await response.text();
      setMarkdown(text);
      setError(null);
    } catch (err: unknown) {
      setMarkdown(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h1>View a Markdown URL</h1>
        <p className="muted">
          Paste a public raw Markdown URL and this page will render it. (Some hosts block cross-origin
          requests; GitHub Raw usually works.)
        </p>
        <form onSubmit={onSubmit} className="stack">
          <label className="label">
            Markdown URL
            <input
              className="input"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={hint}
              spellCheck={false}
              inputMode="url"
            />
          </label>
          <div className="buttonRow">
            <button className="button" type="submit" disabled={loading}>
              {loading ? 'Loading…' : 'Render'}
            </button>
          </div>
        </form>
        {error ? <p className="error">{error}</p> : null}
      </section>

      {markdown ? (
        <article className="prose">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
        </article>
      ) : null}
    </div>
  );
}
