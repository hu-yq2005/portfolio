import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { loadWorkIndex, type WorkEntry } from '../lib/workIndex';

export default function Home() {
  const [searchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') ?? 'home';

  const [work, setWork] = useState<WorkEntry[] | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);

  useEffect(() => {
    loadWorkIndex()
      .then((entries) => {
        setWork(entries);
        setWorkError(null);
      })
      .catch((error: unknown) => {
        setWork(null);
        setWorkError(error instanceof Error ? error.message : String(error));
      });
  }, []);

  const sortedWork = useMemo(() => {
    if (!work) return null;
    return [...work].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  }, [work]);

  return (
    <div className="stack">
      <section className="card">
        <h1>Hi, I’m Yanqiu Hu</h1>
        <p className="muted">
          Welcome to my Portfolio!
        </p>
        <div className="buttonRow">
          <a className="button" href="https://github.com/hu-yq2005/" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <a className="button" href="https://www.linkedin.com/in/huyanqiu//" target="_blank" rel="noreferrer">
            LinkedIn
          </a>
          <a className="button button--ghost" href="/work/index.json" target="_blank" rel="noreferrer">
            Work index JSON
          </a>
        </div>
      </section>

      <section className="card">
        <h2 id="work">Work</h2>
        {workError ? (
          <p className="error">{workError}</p>
        ) : !sortedWork ? (
          <p className="muted">Loading…</p>
        ) : sortedWork.length === 0 ? (
          <p className="muted">No work entries yet. Add a .md file to <code>public/work</code>.</p>
        ) : (
          <ul className="list">
            {sortedWork.map((entry) => (
              <li key={entry.slug} className="list__item">
                <div className="list__title">
                  <Link to={`/work/${encodeURIComponent(entry.slug)}`}>{entry.title}</Link>
                </div>
                <div className="list__meta">
                  {entry.date ? <span>{entry.date}</span> : null}
                  {entry.description ? <span className="muted">{entry.description}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        {activeTab !== 'work' ? (
          <p className="muted"> <code></code> </p>
        ) : null}
      </section>
    </div>
  );
}
