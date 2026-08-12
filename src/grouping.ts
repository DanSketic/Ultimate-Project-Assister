// Grouping projects by the folder they live in.
//
// The cleanup list groups by project; the projects, goals and commands lists
// group by the directory that holds them, which is the level at which a
// developer thinks of projects as belonging together.

export interface Group<T> {
  /** Full parent directory - stable, used as the React key. */
  key: string;
  /** Parent directory with the prefix shared by every group removed. */
  label: string;
  items: T[];
  /** True for the pinned block that sits above the folders. */
  favourite?: boolean;
}

/** Key of the pinned block. Not a path, so it cannot collide with a folder. */
export const FAVOURITES_KEY = "__favourites__";

const SEPARATOR = /[\\/]/;

function segments(path: string): string[] {
  return path.split(SEPARATOR).filter(Boolean);
}

/** The directory holding this project. */
export function parentDir(path: string): string {
  const separator = path.includes("\\") ? "\\" : "/";
  const parts = path.split(SEPARATOR).filter(Boolean);
  parts.pop();
  const joined = parts.join(separator);
  // Keep the leading slash of a unix path.
  return separator === "/" && path.startsWith("/") ? `/${joined}` : joined;
}

/** Leading path segments every directory has in common. */
function commonDepth(dirs: string[]): number {
  if (dirs.length < 2) return 0;
  const split = dirs.map(segments);
  const shortest = Math.min(...split.map((s) => s.length));

  let depth = 0;
  while (depth < shortest) {
    const here = split[0]![depth]!.toLowerCase();
    if (!split.every((s) => s[depth]!.toLowerCase() === here)) break;
    depth++;
  }
  // Never strip everything - a group needs something to show.
  return Math.min(depth, shortest - 1);
}

/**
 * Groups by parent directory, ordered by `weigh` descending. The label drops
 * the prefix every group shares, so `C:\_DEV\_GIT\_GITHUB\OWN` and
 * `C:\_DEV\_TEST` read as `_GIT\_GITHUB\OWN` and `_TEST`.
 */
export function groupByFolder<T extends { path: string }>(
  items: T[],
  weigh: (items: T[]) => number,
): Group<T>[] {
  const byDir = new Map<string, T[]>();
  for (const item of items) {
    const dir = parentDir(item.path);
    const list = byDir.get(dir);
    if (list) list.push(item);
    else byDir.set(dir, [item]);
  }

  const dirs = [...byDir.keys()];
  const depth = commonDepth(dirs);

  return dirs
    .map((key) => {
      const parts = segments(key);
      const separator = key.includes("\\") ? "\\" : "/";
      return {
        key,
        label: parts.slice(depth).join(separator) || parts[parts.length - 1] || key,
        items: byDir.get(key)!,
      };
    })
    .sort((a, b) => weigh(b.items) - weigh(a.items) || a.label.localeCompare(b.label));
}

/**
 * Same as `groupByFolder`, with the pinned projects lifted into a block of
 * their own at the top. Used by Projects, Goals and Commands so a favourite is
 * in the same place whichever list you are looking at.
 */
export function groupWithFavourites<T extends { id: string; path: string }>(
  items: T[],
  favourites: Set<string>,
  weigh: (items: T[]) => number,
  favouritesLabel: string,
): Group<T>[] {
  const pinned = items.filter((i) => favourites.has(i.id));
  const rest = items.filter((i) => !favourites.has(i.id));
  const folders = groupByFolder(rest, weigh);

  return pinned.length
    ? [{ key: FAVOURITES_KEY, label: favouritesLabel, items: pinned, favourite: true }, ...folders]
    : folders;
}
