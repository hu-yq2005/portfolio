export type WorkEntry = {
  slug: string;
  title: string;
  date?: string;
  description?: string;
};

export async function loadWorkIndex(): Promise<WorkEntry[]> {
  const response = await fetch('/work/index.json', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load work index: ${response.status}`);
  }
  const entries = (await response.json()) as WorkEntry[];
  return entries;
}

export async function loadWorkMarkdown(slug: string): Promise<string> {
  const response = await fetch(`/work/${encodeURIComponent(slug)}.md`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Failed to load markdown: ${response.status}`);
  }
  return await response.text();
}
