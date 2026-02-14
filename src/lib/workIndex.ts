export type WorkEntry = {
  slug: string;
  title: string;
  date?: string;
  description?: string;
};

function publicUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  return `${normalizedBase}${normalizedPath}`;
}

export async function loadWorkIndex(): Promise<WorkEntry[]> {
  const response = await fetch(publicUrl('work/index.json'), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load work index: ${response.status}`);
  }
  const entries = (await response.json()) as WorkEntry[];
  return entries;
}

export async function loadWorkMarkdown(slug: string): Promise<string> {
  const response = await fetch(publicUrl(`work/${encodeURIComponent(slug)}.md`), { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load markdown: ${response.status}`);
  }
  return await response.text();
}
