import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';

const workspaceRoot = process.cwd();
const workDir = path.join(workspaceRoot, 'public', 'work');
const indexPath = path.join(workDir, 'index.json');

function slugFromFilename(filename) {
  return filename.replace(/\.md$/i, '');
}

function toIsoDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString().slice(0, 10);
}

function descriptionFromMarkdown(md) {
  const lines = md.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('>')) continue;
    return trimmed.slice(0, 180);
  }
  return undefined;
}

async function main() {
  await fs.mkdir(workDir, { recursive: true });

  const dirEntries = await fs.readdir(workDir, { withFileTypes: true });
  const markdownFiles = dirEntries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const items = [];

  for (const file of markdownFiles) {
    const fullPath = path.join(workDir, file);
    const raw = await fs.readFile(fullPath, 'utf8');
    const parsed = matter(raw);

    const slug = slugFromFilename(file);
    const title =
      typeof parsed.data.title === 'string' && parsed.data.title.trim()
        ? parsed.data.title.trim()
        : slug;

    const date = toIsoDate(parsed.data.date);

    const description =
      typeof parsed.data.description === 'string' && parsed.data.description.trim()
        ? parsed.data.description.trim()
        : descriptionFromMarkdown(parsed.content);

    items.push({ slug, title, date, description });
  }

  items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  await fs.writeFile(indexPath, JSON.stringify(items, null, 2) + '\n', 'utf8');
  process.stdout.write(`Generated ${path.relative(workspaceRoot, indexPath)} (${items.length} items)\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
