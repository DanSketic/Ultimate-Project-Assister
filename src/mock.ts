// Browser-mode sample data.
//
// This is the design's own dataset, reshaped into the runtime types. It only
// ever runs when the UI is opened outside Tauri (`npm run dev:vite`), so the
// layout can be worked on without scanning a real disk.

import type {
  ChangeEntry,
  ClaudeMessage,
  ClaudeSession,
  ClaudeStats,
  CleanProgress,
  CleanTarget,
  CommandDef,
  Commit,
  Container,
  DeleteReport,
  DockerStatus,
  Goal,
  LogLine,
  Note,
  PortConflict,
  ProcessInfo,
  Project,
  RebaseReport,
  Settings,
  SyncStatus,
  ToolStatus,
} from "./types";

const MB = 1024 * 1024;

type Row = [
  name: string,
  path: string,
  stack: string,
  langs: string[],
  files: number,
  sizeMb: number,
  reclaimMb: number,
  version: string,
  tag: string,
  branch: string,
  dirty: number,
  ahead: number,
  behind: number,
  days: number,
  desc: string,
];

const ROWS: Row[] = [
  ["ultimate-project-assister", "D:\\dev\\rust\\ultimate-project-assister", "Rust", ["Rust 74", "TypeScript 21", "CSS 5"], 812, 1940, 1420, "0.4.2", "v0.4.2", "main", 7, 2, 0, 0, "Ez az app: projekt radar, takarító, célok és board egy helyen."],
  ["pixelforge", "D:\\dev\\rust\\pixelforge", "Rust", ["Rust 96", "Shell 4"], 1204, 3180, 2610, "1.2.0", "v1.2.0", "feat/gpu-blur", 3, 4, 2, 2, "GPU-s képfeldolgozó pipeline wgpu-val, batch exporttal."],
  ["tauri-notes", "D:\\dev\\rust\\tauri-notes", "Rust", ["Rust 58", "TypeScript 36", "CSS 6"], 640, 1520, 1180, "0.9.1", "v0.9.0", "main", 0, 0, 0, 12, "Offline jegyzetelő Tauri + SQLite alapon."],
  ["csv-magic", "D:\\dev\\rust\\csv-magic", "Rust", ["Rust 100"], 96, 720, 640, "2.3.1", "v2.3.1", "main", 1, 1, 0, 5, "CLI nagy CSV-k streamelt átalakításához."],
  ["sqlite-bench", "D:\\dev\\rust\\sqlite-bench", "Rust", ["Rust 91", "Python 9"], 158, 980, 910, "0.2.0", "v0.2.0", "bench/wal", 12, 0, 0, 41, "SQLite írási módok összehasonlítása terhelés alatt."],
  ["photo-organizer", "D:\\dev\\rust\\photo-organizer", "Rust", ["Rust 88", "Shell 12"], 402, 2240, 1960, "0.6.4", "v0.6.3", "main", 2, 3, 1, 3, "EXIF alapú rendszerező, duplikátum szűréssel."],
  ["wasm-viewer", "D:\\dev\\rust\\wasm-viewer", "Rust", ["Rust 70", "TypeScript 25", "HTML 5"], 288, 1310, 1090, "0.3.0", "v0.3.0", "main", 0, 0, 0, 27, "3D modell néző WASM-ben, böngészőben fut."],
  ["embedded-blinky", "D:\\dev\\rust\\embedded-blinky", "Rust", ["Rust 100"], 64, 410, 360, "0.1.2", "v0.1.2", "main", 0, 0, 0, 96, "no_std kísérlet STM32-re, embassy runtime-mal."],
  ["shopflow-web", "D:\\dev\\web\\shopflow-web", "TypeScript", ["TypeScript 82", "CSS 13", "MDX 5"], 2860, 4120, 3540, "3.4.0", "v3.4.0", "release/3.4", 14, 0, 3, 1, "Webshop front-end, a fő kliens projekt."],
  ["dashboard-kit", "D:\\dev\\web\\dashboard-kit", "TypeScript", ["TypeScript 88", "CSS 12"], 1640, 2380, 2050, "1.9.2", "v1.9.2", "main", 5, 1, 0, 4, "Belső komponens könyvtár riportokhoz."],
  ["static-portfolio", "D:\\dev\\web\\static-portfolio", "Astro", ["Astro 54", "TypeScript 30", "CSS 16"], 420, 940, 810, "1.0.3", "v1.0.3", "main", 0, 0, 0, 63, "Saját portfólió oldal, statikusan generált."],
  ["chat-relay", "D:\\dev\\web\\chat-relay", "Node", ["JavaScript 94", "Dockerfile 6"], 780, 1480, 1310, "0.8.0", "—", "main", 22, 0, 0, 18, "WebSocket relay szerver, sok félbehagyott branch."],
  ["mail-templater", "D:\\dev\\web\\mail-templater", "TypeScript", ["TypeScript 76", "MJML 24"], 320, 810, 700, "0.7.1", "v0.7.1", "main", 0, 0, 0, 30, "Tranzakciós email sablonok MJML-ből."],
  ["api-gateway", "D:\\dev\\go\\api-gateway", "Go", ["Go 93", "Dockerfile 7"], 340, 1120, 780, "2.1.0", "v2.1.0", "main", 4, 0, 0, 2, "Rate limitelő és auth proxy a szolgáltatások előtt."],
  ["auth-service", "D:\\dev\\go\\auth-service", "Go", ["Go 95", "SQL 5"], 268, 640, 420, "1.4.3", "v1.4.3", "fix/jwt-refresh", 9, 2, 0, 6, "JWT kiadás és refresh, Postgres tárolással."],
  ["ml-playground", "D:\\dev\\py\\ml-playground", "Python", ["Python 96", "Notebook 4"], 1180, 6840, 5920, "—", "—", "main", 31, 0, 0, 9, "Kísérletek, checkpointok — a legnagyobb szemétgyár."],
  ["scraper-suite", "D:\\dev\\py\\scraper-suite", "Python", ["Python 98", "YAML 2"], 460, 1960, 1720, "1.1.0", "v1.1.0", "main", 3, 0, 0, 22, "Ütemezett adatgyűjtők, playwright alapon."],
  ["hu-nyelvtan-api", "D:\\dev\\py\\hu-nyelvtan-api", "Python", ["Python 97", "Dockerfile 3"], 214, 1480, 1220, "0.4.0", "v0.4.0", "main", 0, 0, 0, 35, "Magyar morfológiai elemző FastAPI-ban."],
  ["old-thesis-tools", "D:\\dev\\archive\\old-thesis-tools", "Python", ["MATLAB 61", "Python 39"], 328, 2110, 1880, "—", "—", "master", 0, 0, 0, 712, "Szakdolgozat scriptek, archívum — takarítható."],
  ["docker-lab", "D:\\dev\\ops\\docker-lab", "Docker", ["Shell 62", "Dockerfile 38"], 96, 5240, 4980, "—", "—", "main", 2, 0, 0, 15, "Compose stackek próbája — a cache elszállt."],
  ["k8s-manifests", "D:\\dev\\ops\\k8s-manifests", "YAML", ["YAML 100"], 142, 24, 0, "1.0.0", "v1.0.0", "main", 1, 0, 0, 8, "Éles és staging manifestek, kustomize overlay-ekkel."],
  ["crm-mobile", "D:\\dev\\mobile\\crm-mobile", "Dart", ["Dart 92", "Kotlin 5", "Swift 3"], 890, 3460, 2980, "2.0.1", "v2.0.1", "main", 6, 0, 1, 11, "Flutter kliens a CRM-hez, offline sync-kel."],
  ["game-of-life", "D:\\dev\\misc\\game-of-life", "C++", ["C++ 100"], 48, 320, 290, "1.0.0", "v1.0.0", "main", 0, 0, 0, 158, "Hétvégi projekt, SDL2-vel rajzolva."],
  ["blog-engine", "D:\\dev\\misc\\blog-engine", "Elixir", ["Elixir 89", "HEEx 11"], 512, 860, 690, "0.5.0", "v0.5.0", "main", 0, 0, 2, 74, "Phoenix blog motor, félbehagyott kísérlet."],
  ["legacy-invoicer", "D:\\dev\\archive\\legacy-invoicer", "PHP", ["PHP 86", "Twig 14"], 1420, 1180, 640, "4.2.7", "v4.2.7", "master", 0, 0, 0, 402, "Régi számlázó, még fut egy kliensnél."],
  // Two stacks that each hold a `clients` and a `server`. Names collide across
  // folders on purpose - selecting one must never light up the other.
  ["clients", "D:\\dev\\apps\\browser-tools\\clients", "TypeScript", ["TypeScript 92", "CSS 8"], 180, 640, 520, "0.3.0", "v0.3.0", "main", 2, 0, 0, 6, "Böngésző oldali kliens a browser-tools stackhez."],
  ["server", "D:\\dev\\apps\\browser-tools\\server", "Node", ["JavaScript 96", "Dockerfile 4"], 210, 720, 610, "0.3.0", "v0.3.0", "main", 1, 0, 0, 6, "API szerver a browser-tools stackhez."],
  ["clients", "D:\\dev\\apps\\reflow\\clients", "TypeScript", ["TypeScript 90", "CSS 10"], 160, 580, 470, "1.1.0", "v1.1.0", "main", 0, 0, 0, 19, "Reflow kliens felület."],
  ["server", "D:\\dev\\apps\\reflow\\server", "Node", ["JavaScript 97", "SQL 3"], 190, 660, 550, "1.1.0", "v1.1.0", "main", 3, 1, 0, 19, "Reflow háttérszolgáltatás."],
];

const MSG = [
  "refactor: split scanner into modules",
  "fix: handle missing Cargo.lock",
  "feat: cache git status per repo",
  "chore: bump deps",
  "perf: parallel walk with rayon",
  "docs: update readme",
  "test: add snapshot tests",
  "fix: windows path separators",
  "feat: tag parsing from refs",
  "style: clippy pass",
];

function cleanTargetsFor(row: Row, index: number, projectId: string): CleanTarget[] {
  const [name, path, stack, , , , reclaimMb, , , , , , , days] = row;
  const parts: Array<[string, string, number]> = [];

  switch (stack) {
    case "Rust":
      // No nested `incremental` entry: the real rules deliberately fold it
      // into target/debug so a row never frees more than it says.
      parts.push(
        ["target/debug", `${path}\\target\\debug`, reclaimMb * 0.7],
        ["target/release", `${path}\\target\\release`, reclaimMb * 0.3],
      );
      break;
    case "TypeScript":
    case "Node":
    case "Astro":
      parts.push(
        ["node_modules", `${path}\\node_modules`, reclaimMb * 0.66],
        ["dist / .next", `${path}\\.next`, reclaimMb * 0.22],
        [".turbo cache", `${path}\\.turbo`, reclaimMb * 0.12],
      );
      break;
    case "Python":
      parts.push(
        [".venv", `${path}\\.venv`, reclaimMb * 0.54],
        ["__pycache__", `${path}\\**\\__pycache__`, reclaimMb * 0.14],
        ["checkpoints", `${path}\\artifacts`, reclaimMb * 0.32],
      );
      break;
    case "Go":
      parts.push(["build cache", `${path}\\bin`, reclaimMb * 0.58], ["vendor", `${path}\\vendor`, reclaimMb * 0.42]);
      break;
    case "Docker":
      parts.push(
        ["docker images", "dangling images (docker-lab)", reclaimMb * 0.58],
        ["build cache", "buildx cache", reclaimMb * 0.42],
      );
      break;
    case "Dart":
      parts.push(["build/", `${path}\\build`, reclaimMb * 0.7], [".dart_tool", `${path}\\.dart_tool`, reclaimMb * 0.3]);
      break;
    case "PHP":
      parts.push(["vendor", `${path}\\vendor`, reclaimMb * 0.62], ["var/cache", `${path}\\var\\cache`, reclaimMb * 0.38]);
      break;
    case "C++":
    case "Elixir":
      parts.push(["build/", `${path}\\_build`, reclaimMb]);
      break;
    default:
      break;
  }

  const members = MONOREPO[name];

  return parts
    .filter(([, , mb]) => mb >= 12)
    .map(([cat, p, mb], j) => {
      // In a monorepo the junk lives inside the packages, not at the root.
      const part = members ? members[j % members.length]![0] : "";
      const full = part ? p.replace(`${path}\\`, `${path}\\${part}\\`) : p;
      return {
        key: `${projectId}|${cat}|${full}`,
        projectId,
        project: name,
        part,
        cat,
        path: full,
        bytes: Math.round(mb) * MB,
        ageDays: days + ((index * 13 + j * 29) % 120),
      };
    });
}

/** Kept in step with `PRIMARY` in src-tauri/src/cmds.rs. */
const PRIMARY_NAMES = [
  "dev",
  "dev run",
  "start",
  "serve",
  "server",
  "run",
  "runserver",
  "build",
  "release build",
  "test",
  "tests",
  "stack up",
];

function commandsFor(name: string, stack: string, cwd = ""): CommandDef[] {
  const out: CommandDef[] = [];
  const add = (kind: CommandDef["kind"], source: string, n: string, cmd: string) =>
    out.push({
      kind,
      name: n,
      cmd,
      cwd,
      part: cwd || name,
      source,
      primary: PRIMARY_NAMES.includes(n),
    });

  switch (stack) {
    case "Rust":
      add("cargo", "Cargo.toml", "dev run", "cargo run");
      add("cargo", "Cargo.toml", "release build", "cargo build --release");
      add("cargo", "Cargo.toml", "test", "cargo test --all");
      add("cargo", "Cargo.toml", "clippy", "cargo clippy -- -D warnings");
      break;
    case "TypeScript":
    case "Node":
    case "Astro":
      // Enough scripts, with variants, to show the grouping and the promotion
      // of the headline ones doing real work.
      add("npm", "package.json", "dev", "npm run dev");
      add("npm", "package.json", "build", "npm run build");
      add("npm", "package.json", "test", "npm run test");
      add("npm", "package.json", "lint", "npm run lint");
      add("npm", "package.json", "lint:fix", "npm run lint:fix");
      add("npm", "package.json", "test:e2e", "npm run test:e2e");
      add("npm", "package.json", "typecheck", "npm run typecheck");
      add("npm", "package.json", "format", "npm run format");
      break;
    case "Python":
      add("py", "pyproject.toml", "serve", "uvicorn app:api --reload");
      add("py", "pyproject.toml", "tests", "pytest -q");
      break;
    case "Go":
      add("make", "go.mod", "run", "go run ./...");
      add("docker", "docker-compose.yml", "stack up", "docker compose up -d");
      break;
    case "Docker":
    case "YAML":
      add("docker", "docker-compose.yml", "stack up", "docker compose up");
      add("docker", "docker-compose.yml", "stack down", "docker compose down -v");
      add("docker", "Dockerfile", "prune", "docker system prune -f");
      break;
    case "Dart":
      add("make", "pubspec.yaml", "run android", "flutter run -d android");
      add("make", "pubspec.yaml", "build apk", "flutter build apk");
      break;
    case "PHP":
      add("make", "composer.json", "serve", "php -S localhost:8000 -t public");
      break;
    case "C++":
    case "Elixir":
      add("make", "Makefile", "build", "make build");
      add("make", "Makefile", "run", "make run");
      break;
    default:
      break;
  }

  if (name === "shopflow-web" && !cwd) {
    add("docker", "docker-compose.yml", "db + redis", "docker compose up -d db redis");
  }
  return out;
}

/// Projects whose folder holds several packages, to exercise the parts UI.
const MONOREPO: Record<string, Array<[rel: string, stack: string, share: number]>> = {
  "shopflow-web": [
    ["frontend", "TypeScript", 0.62],
    ["backend", "Go", 0.38],
  ],
};

function manifestsFor(stack: string, name: string): string[] {
  switch (stack) {
    case "Rust":
      return ["Cargo.toml"];
    case "TypeScript":
    case "Node":
    case "Astro":
      return name === "shopflow-web" ? ["package.json", "docker-compose.yml"] : ["package.json"];
    case "Python":
      return ["pyproject.toml"];
    case "Go":
      return ["Makefile", "docker-compose.yml"];
    case "Docker":
    case "YAML":
      return ["docker-compose.yml"];
    default:
      return ["Makefile"];
  }
}

/**
 * A README long enough to need collapsing, exercising every block the markdown
 * renderer handles: headings, prose, a list, a fenced block, a table, a quote.
 */
function readmeFor(name: string, stack: string, desc: string): string {
  return `# ${name}

${desc} Written in **${stack}**, and kept deliberately small.

## Getting started

Clone it, install the dependencies and start the dev server. The only thing you
need on your machine is a recent toolchain — everything else is vendored.

\`\`\`sh
git clone https://example.invalid/${name}.git
cd ${name}
make dev
\`\`\`

## What is in the box

- A \`core/\` module that does the actual work
- An adapter layer, so the transport can be swapped without touching \`core/\`
- A test suite that runs in under ten seconds

| Directory | Purpose |
| --- | --- |
| \`core/\` | Domain logic, no I/O |
| \`adapters/\` | Everything that talks to the outside world |
| \`tests/\` | Fixtures and the suite itself |

> Nothing in \`core/\` may import from \`adapters/\`. The dependency only ever
> points inwards.

## Licence

MIT. See [LICENSE](LICENSE).
`;
}

function changelogFor(i: number, version: string): ChangeEntry[] {
  // Counts back through minor versions so every entry is distinct, the way a
  // real file reads. `0.4.2` yields 0.4.2, 0.4.1, 0.4.0, 0.3.9, ...
  const [maj = "0", min = "0", patch = "0"] = version.split(".");
  const flat = Number(min) * 10 + Number(patch);
  const back = (k: number) => {
    const n = Math.max(0, flat - k);
    return `${maj}.${Math.floor(n / 10)}.${n % 10}`;
  };

  // Nine, so the "5 shown, the rest on request" behaviour is reachable in the
  // browser build the same way it is on a real project.
  return [0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({
    ver: back(k),
    date: `2026-0${1 + ((i + k) % 8)}-${10 + ((i * 3 + k) % 18)}`,
    body: `### ${k === 0 ? "Added" : "Fixed"}

- ${MSG[(i + k) % MSG.length]}, which had been on the list for a while.
- ${MSG[(i + k + 4) % MSG.length]}. The old behaviour is kept behind a flag for
  one more release.

### Changed

- The \`--verbose\` flag now prints timings as well as the step names.
`,
  }));
}

let CACHE: Project[] | null = null;

export function projects(): Project[] {
  if (CACHE) return CACHE;

  CACHE = ROWS.map((row, i) => {
    const [name, path, stack, langs, files, sizeMb, reclaimMb, version, tag, branch, dirty, ahead, behind, days, desc] = row;
    const targets = cleanTargetsFor(row, i, `mock${i}`);
    const members = MONOREPO[name];

    const parts = members
      ? members.map(([rel, partStack, share]) => ({
          name: rel,
          rel,
          path: `${path}\\${rel}`,
          stack: partStack,
          manifests: manifestsFor(partStack, name),
          sizeBytes: Math.round(sizeMb * share) * MB,
          reclaimBytes: Math.round(reclaimMb * share) * MB,
          sourceBytes: Math.round(files * share) * 137,
        }))
      : [
          {
            name,
            rel: "",
            path,
            stack,
            manifests: manifestsFor(stack, name),
            sizeBytes: sizeMb * MB,
            reclaimBytes: reclaimMb * MB,
            sourceBytes: files * 137,
          },
        ];

    const commands = members
      ? [
          ...members.flatMap(([rel, partStack]) => commandsFor(name, partStack, rel)),
          ...commandsFor(name, "Docker"),
        ]
      : commandsFor(name, stack);

    return {
      id: `mock${i}`,
      name,
      path,
      stack,
      langs: langs.map((l) => {
        const at = l.lastIndexOf(" ");
        return { name: l.slice(0, at), pct: Number(l.slice(at + 1)) };
      }),
      files,
      loc: files * 137,
      sizeBytes: sizeMb * MB,
      reclaimBytes: reclaimMb * MB,
      version,
      desc,
      // Two projects deliberately have neither, so the empty states are
      // reachable in the browser build.
      readme: i % 7 === 3 ? "" : readmeFor(name, stack, desc),
      changelog: i % 5 === 2 ? [] : changelogFor(i, version),
      manifests: [...new Set(parts.flatMap((p) => p.manifests))],
      parts,
      commands,
      cleanTargets: targets,
      git: {
        isRepo: true,
        branch,
        dirty,
        ahead,
        behind,
        days,
        tag,
        tags: tag === "—" ? [] : [tag, `v${version.replace(/\.\d+$/, ".0")}`],
        commits: [0, 1, 2, 3, 4].map((k) => ({
          sha: (i * 7 + k * 131).toString(16).padStart(4, "a") + "f" + (k + 2),
          msg: MSG[(i + k) % MSG.length]!,
          days: days + k * 2,
          date: "",
          author: "DanSketic",
        })),
        releases:
          tag === "—"
            ? []
            : [
                {
                  ver: tag,
                  date: `2026-0${1 + (i % 7)}-1${i % 9}`,
                  notes: [MSG[i % MSG.length]!, MSG[(i + 3) % MSG.length]!],
                },
                {
                  ver: `v${version.replace(/\d+$/, "0")}`,
                  date: `2026-0${1 + ((i + 2) % 6)}-0${2 + (i % 7)}`,
                  notes: [MSG[(i + 5) % MSG.length]!, MSG[(i + 7) % MSG.length]!],
                },
              ],
        firstCommit: `${2019 + (i % 6)}-0${1 + (i % 8)}-1${i % 9}`,
        lastCommit: "",
        // A couple of projects have no remote, so the unlinked tag chips are
        // reachable in the browser build too.
        remote: i % 6 === 4 ? "" : `https://github.com/DanSketic/${name}`,
        fetchDays: mockFetchDays(i),
      },
      scannedAt: Math.floor(Date.now() / 1000),
    };
  });

  return CACHE;
}

export function settings(): Settings {
  return {
    lang: "hu",
    theme: "auto",
    navCollapsed: false,
    anchor: "left",
    folders: ["D:\\dev\\rust", "D:\\dev\\web", "D:\\dev\\py", "D:\\dev\\go", "D:\\dev\\ops"],
    toggles: { scanStart: true, watchFs: true, deepGit: true, fetchOnScan: false, docker: false },
    ageDays: 30,
    cmdFavourites: [],
    favouritesOnly: false,
    osNotifications: false,
    collapsedGroups: [],
    cleanPicked: null,
    rules: [
      { pattern: "node_modules", scope: "keep: shopflow-web" },
      { pattern: "*.sqlite", scope: "never delete" },
      { pattern: "target/release", scope: "only after 90 days" },
      { pattern: ".venv", scope: "keep: hu-nyelvtan-api" },
    ],
    favourites: ["mock0", "mock8"],
    freedBytes: 0,
    freedDate: "",
    window: { x: null, y: null, height: null, maximized: false, widths: {} },
  };
}

export function goals(): Goal[] {
  const raw: Array<[string, string, string, Array<[string, boolean, string]>]> = [
    ["ultimate-project-assister", "0.5 — Cleaner engine", "Takarító motor teljes lefedéssel", [
      ["Dry-run preview minden kategóriára", true, "2d"],
      ["Kategória szabályok + kizárások", true, "1d"],
      ["Docker cache és dangling image-ek", false, "3d"],
      ["Ütemezett heti takarítás", false, "2d"],
    ]],
    ["ultimate-project-assister", "0.6 — Board & goals", "Cetlik, célok, határidők", [
      ["Szabad canvas, húzható cetlik", true, "3d"],
      ["Projekt tag és szűrő", true, "1d"],
      ["Határidő értesítés a tálcán", false, "2d"],
      ["Markdown a note törzsében", false, "1d"],
    ]],
    ["ultimate-project-assister", "1.0 — Windows release", "Telepíthető, aláírt build", [
      ["MSI installer (wix)", false, "3d"],
      ["Auto-update csatorna", false, "4d"],
      ["Ikon és branding", false, "1d"],
      ["Kézikönyv HU/EN", false, "2d"],
    ]],
    ["shopflow-web", "Checkout rework", "Konverzió növelés a fizetésnél", [
      ["Egylépéses fizetés", true, "5d"],
      ["Kosár mentés eszközök között", true, "2d"],
      ["Apple Pay / Google Pay", false, "3d"],
    ]],
    ["pixelforge", "GPU pipeline", "wgpu compute utak", [
      ["Compute blur shader", true, "4d"],
      ["Multi-pass render graph", false, "5d"],
      ["Batch export CLI-ből", false, "2d"],
    ]],
    ["ml-playground", "Kísérlet rendszerezés", "Reprodukálható futások", [
      ["Notebook → script", true, "2d"],
      ["MLflow bekötés", false, "3d"],
      ["Checkpoint takarítás automata", false, "1d"],
    ]],
  ];

  return raw.map(([project, title, sub, features], gi) => ({
    id: `g${gi}`,
    project,
    title,
    sub,
    features: features.map(([t, done, est], fi) => ({ id: `g${gi}f${fi}`, title: t, done, est })),
  }));
}

export function notes(): Note[] {
  const raw: Array<[number, number, string, string, string, Note["color"]]> = [
    [40, 32, "sqlite-bench", "Fix the WAL benchmark — 8 szál felett deadlock. Repro: bench/wal branch.", "2026-08-11", "paper"],
    [324, 60, "ultimate-project-assister", "MSI installer + code signing tanúsítvány megvenni (EV vs OV?).", "2026-08-20", "accent"],
    [616, 28, "shopflow-web", "Checkout A/B eredmény kiértékelése a klienssel — dia kell.", "2026-08-07", "paper"],
    [60, 300, "ml-playground", "5.9 GB szemét: wandb/ + checkpoints kitakarítása, előtte 3 futás mentése.", "2026-08-04", "accent"],
    [384, 330, "docker-lab", "Dangling image-ek 4.9 GB — prune, majd compose fájlok átnézése.", "2026-08-09", "ink"],
    [708, 300, "api-gateway", "2.1 release notes + changelog összefésülés a tagekből.", "2026-08-14", "paper"],
    [120, 572, "auth-service", "JWT refresh PR review Bencének, utána merge fix/jwt-refresh.", "2026-08-08", "paper"],
    [444, 604, "ultimate-project-assister", "Ötlet: cetlikhez kódrészlet blokk + link a commitra.", "", "ink"],
    [796, 592, "static-portfolio", "Portfólió frissítés — 2 új projekt, régi képek cseréje.", "", "paper"],
  ];

  return raw.map(([x, y, project, text, due, color], i) => ({
    id: `n${i}`,
    x,
    y,
    project,
    text,
    due,
    color,
    z: i + 1,
  }));
}

// --- fake runner ------------------------------------------------------------

const LOG_POOL: Record<string, string[]> = {
  npm: ["ready in 412 ms", "hmr update /src/pages/checkout.tsx", "page reload /src/app.tsx", "warn: unused export in cart.ts", "compiled successfully in 189 ms"],
  docker: ["container api-1  Started", "attaching to db-1, api-1", "db-1   | database system is ready", "api-1  | listening on :8080"],
  cargo: ["Compiling upa v0.4.2", "Finished dev [unoptimized + debuginfo] in 8.42s", "Running `target\\debug\\upa.exe`", "warn: unused variable: `depth`"],
  make: ["make: entering directory", "gcc -O2 -c main.c", "linking build/app"],
  py: ["collected 42 items", "tests/test_scan.py ......", "42 passed in 3.11s"],
};

const running = new Set<string>();
const listeners = new Set<(line: LogLine) => void>();
let timer: number | undefined;

function kindOf(cmd: string): string {
  for (const k of ["npm", "docker", "cargo", "make"]) if (cmd.startsWith(k)) return k;
  return "py";
}

function hms(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function emit(key: string, text: string, stream: LogLine["stream"]) {
  const [projectId = "", , cmd = ""] = key.split("|");
  const project = projects().find((p) => p.id === projectId)?.name ?? projectId;
  const line: LogLine = { key, project, cmd, text, stream, time: hms() };
  listeners.forEach((l) => l(line));
}

function ensureTimer() {
  if (timer !== undefined) return;
  timer = window.setInterval(() => {
    const keys = [...running];
    if (!keys.length) return;
    const key = keys[Math.floor(Math.random() * keys.length)]!;
    const pool = LOG_POOL[kindOf(key.split("|")[2] ?? "")] ?? LOG_POOL.py!;
    emit(key, pool[Math.floor(Math.random() * pool.length)]!, "out");
  }, 2200);
}

export function onLog(handler: (line: LogLine) => void): () => void {
  listeners.add(handler);
  ensureTimer();
  return () => listeners.delete(handler);
}

// Keyed by project *id*, exactly as `runner::key_of` does on the Rust side.
// Keying by name here meant the running indicator and the log tabs matched
// nothing in the browser build.
export async function runCommand(
  projectId: string,
  cmd: string,
  cwd = "",
  port?: number,
): Promise<void> {
  const name = projects().find((p) => p.id === projectId)?.name ?? projectId;
  const key = `${projectId}|${cwd}|${cmd}`;
  running.add(key);
  // The echo shows the line that ran, which is how a moved command says so.
  const line = port ? mockWithPort(cmd, port) : cmd;
  emit(key, `$ ${line}  (${name}${cwd ? `/${cwd}` : ""})`, "cmd");
}

/** Mirrors `ports::with_port` closely enough for the browser build. */
function mockWithPort(cmd: string, port: number): string {
  if (/--port[= ]|-p[= ]|PORT=/.test(cmd)) {
    return cmd.replace(/((?:--port|-p)[= ]|PORT=)\d+/, `$1${port}`);
  }
  return cmd.startsWith("npm run ") ? `${cmd} -- --port ${port}` : `${cmd} --port ${port}`;
}

export async function stopCommand(projectId: string, cmd: string, cwd = ""): Promise<void> {
  const key = `${projectId}|${cwd}|${cmd}`;
  running.delete(key);
  emit(key, `^C  ${cmd} stopped`, "exit");
}

export async function runningCommands(): Promise<string[]> {
  return [...running];
}

/**
 * A stand-in for the real port check. Ports are derived the same way — the
 * command line first, then a framework default — and a port is "taken" when
 * another mock run already claimed it, so the dialog is reachable in the
 * browser build by starting two dev servers.
 */
function mockPortFor(cmd: string): number {
  const explicit = /(?:--port[= ]|-p[= ]|PORT=)(\d{4,5})/.exec(cmd);
  if (explicit) return Number(explicit[1]);
  for (const [needle, port] of [
    ["vite", 5173], ["nuxt", 3000], ["next", 3000], ["astro", 4321],
    ["uvicorn", 8000], ["compose up", 8080],
  ] as Array<[string, number]>) {
    if (cmd.includes(needle)) return port;
  }
  if (cmd.includes(" run dev") || cmd.includes(" run start")) return 3000;
  return 0;
}

export async function checkPort(
  projectId: string,
  cmd: string,
  cwd = "",
): Promise<PortConflict> {
  const port = mockPortFor(cmd);
  if (port === 0) return { port: 0, taken: false, holder: null, process: null, suggestedPort: 0, suggestedCmd: "" };

  const mine = `${projectId}|${cwd}|${cmd}`;
  for (const key of running) {
    if (key === mine) continue;
    const [otherId = "", , otherCmd = ""] = key.split("|");
    if (mockPortFor(otherCmd) !== port) continue;
    const project = projects().find((p) => p.id === otherId);
    return {
      port,
      taken: true,
      holder: { key, projectId: otherId, project: project?.name ?? otherId, cmd: otherCmd },
      process: null,
      suggestedPort: port + 1,
      suggestedCmd: mockWithPort(cmd, port + 1),
    };
  }

  // 8080 stands in for a port held by something outside the app, so the
  // stop-a-foreign-process path is reachable in the browser build.
  if (port === 8080) {
    return {
      port,
      taken: true,
      holder: null,
      process: {
        pid: 24672,
        name: "node.exe",
        exe: "C:\\Users\\dansk\\AppData\\Local\\Volta\\tools\\image\\node\\24.14.1\\node.exe",
        killable: true,
      },
      suggestedPort: port + 1,
      suggestedCmd: mockWithPort(cmd, port + 1),
    };
  }
  return { port, taken: false, holder: null, process: null, suggestedPort: 0, suggestedCmd: "" };
}

/**
 * A believable machine: two dev servers this app started, a stray one it did
 * not, a database, and a system process that may not be stopped.
 */
export function runningProcesses(): ProcessInfo[] {
  const all = projects();
  const shopflow = all.find((p) => p.name === "shopflow-web");
  const api = all.find((p) => p.name === "api-gateway");

  const row = (o: Partial<ProcessInfo> & { pid: number; name: string }): ProcessInfo => ({
    parentPid: 0, exe: "", cmd: "", cwd: "", memoryBytes: 0, runSecs: 0, ports: [],
    projectId: "", project: "", commandKey: "", killable: true, ...o,
  });

  return [
    row({
      pid: 21088, name: "node.exe", memoryBytes: 412 * MB, runSecs: 2 * 3600 + 900, ports: [1420],
      cmd: "node vite.js", projectId: all[0]?.id ?? "", project: all[0]?.name ?? "",
      commandKey: `${all[0]?.id}||npm run dev`,
    }),
    row({
      pid: 33912, name: "node.exe", memoryBytes: 286 * MB, runSecs: 1840, ports: [3000],
      cmd: "node server.js", projectId: shopflow?.id ?? "", project: shopflow?.name ?? "",
      commandKey: `${shopflow?.id}|frontend|npm run dev`,
    }),
    row({
      pid: 14204, name: "go.exe", memoryBytes: 96 * MB, runSecs: 640, ports: [8080],
      cmd: "go run ./...", projectId: api?.id ?? "", project: api?.name ?? "",
    }),
    row({
      pid: 9088, name: "node.exe", memoryBytes: 198 * MB, runSecs: 26 * 3600, ports: [5173],
      cmd: "node vite.js  (started from a terminal two days ago)",
      cwd: "C:\\_DEV\\_GIT\\_GITHUB\\_OWN\\ultimate-network-assister",
    }),
    row({
      pid: 7720, name: "postgres.exe", memoryBytes: 148 * MB, runSecs: 5 * 86400, ports: [5432],
      cmd: "postgres -D data",
    }),
    row({ pid: 1284, name: "svchost.exe", memoryBytes: 24 * MB, runSecs: 9 * 86400, ports: [135], killable: false }),
  ];
}

export async function stopProcess(pid: number): Promise<string> {
  await pause(320);
  return `node.exe (${pid})`;
}

export async function freePort(port: number): Promise<string> {
  await pause(400);
  return `node.exe (:${port})`;
}

const cleanListeners = new Set<(p: CleanProgress) => void>();

export function onCleanProgress(handler: (p: CleanProgress) => void): () => void {
  cleanListeners.add(handler);
  return () => cleanListeners.delete(handler);
}

function emitClean(p: CleanProgress) {
  cleanListeners.forEach((l) => l(p));
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function deleteTargets(keys: string[]): Promise<DeleteReport> {
  const all = projects().flatMap((p) => p.cleanTargets);
  const hit = all.filter((t) => keys.includes(t.key));

  const totalBytes = hit.reduce((sum, t) => sum + t.bytes, 0);

  // Step through the targets so the progress UI has something to show, in the
  // same byte terms the real backend reports.
  let freed = 0;
  for (const [i, target] of hit.entries()) {
    emitClean({ phase: "delete", done: i, total: hit.length, current: target.path, freedBytes: freed, totalBytes });
    await pause(160);
    freed += target.bytes;
  }
  emitClean({ phase: "rescan", done: 0, total: 1, current: "", freedBytes: freed, totalBytes });
  await pause(300);

  // Shrink the in-memory dataset so the numbers move like the real thing.
  for (const p of projects()) {
    const removed = p.cleanTargets.filter((t) => keys.includes(t.key));
    if (!removed.length) continue;
    const freed = removed.reduce((a, t) => a + t.bytes, 0);
    p.cleanTargets = p.cleanTargets.filter((t) => !keys.includes(t.key));
    p.reclaimBytes = Math.max(0, p.reclaimBytes - freed);
    p.sizeBytes = Math.max(0, p.sizeBytes - freed);
  }

  emitClean({ phase: "done", done: 1, total: 1, current: "", freedBytes: freed, totalBytes });

  return { freedBytes: freed, removed: hit.map((t) => t.path), errors: [] };
}

// ---------------------------------------------------------------------------
// Docker and toolchains
// ---------------------------------------------------------------------------

/** Installed, daemon up, with a stack running — the interesting case to draw. */
export function dockerStatus(): DockerStatus {
  return {
    installed: true,
    cliVersion: "27.1.1",
    daemonRunning: true,
    serverVersion: "27.1.1",
    containersRunning: 3,
    containersTotal: 7,
    images: 42,
    imagesBytes: 18.4 * MB * 1024,
    buildCacheBytes: 6.1 * MB * 1024,
    volumesBytes: 2.3 * MB * 1024,
    error: "",
  };
}

export function containers(projectId: string): Container[] {
  // Only the compose project has a stack, the same way a real machine would.
  const project = projects().find((p) => p.id === projectId);
  if (!project || !project.manifests.some((m) => m.startsWith("docker-compose"))) return [];

  return [
    { id: "a1b2c3d4e5f6", name: `${project.name}-db-1`, image: "postgres:16", state: "running",
      status: "Up 3 hours (healthy)", ports: "0.0.0.0:5432->5432/tcp", service: "db" },
    { id: "b2c3d4e5f6a1", name: `${project.name}-redis-1`, image: "redis:7-alpine", state: "running",
      status: "Up 3 hours", ports: "0.0.0.0:6379->6379/tcp", service: "redis" },
    { id: "c3d4e5f6a1b2", name: `${project.name}-worker-1`, image: "node:22-slim", state: "exited",
      status: "Exited (0) 12 minutes ago", ports: "", service: "worker" },
  ];
}

/** One missing tool, so the install path is reachable in the browser build. */
export function requirements(projectId: string): ToolStatus[] {
  const project = projects().find((p) => p.id === projectId);
  if (!project) return [];

  const out: ToolStatus[] = [];
  const add = (
    id: string, name: string, found: boolean, version: string, requiredBy: string[],
    install: string, docs: string,
  ) =>
    out.push({
      id,
      name,
      found,
      version,
      path: found ? `C:\\tools\\${id}\\${id}.exe` : "",
      requiredBy,
      install,
      docs,
    });

  const wants = (m: string) => project.parts.some((p) => p.manifests.includes(m));

  if (wants("package.json")) {
    add("node", "Node.js", true, "22.3.0", ["package.json"],
        "winget install --exact --id OpenJS.NodeJS.LTS", "https://nodejs.org");
    add("npm", "npm", true, "10.8.1", ["package.json"],
        "winget install --exact --id OpenJS.NodeJS.LTS", "https://docs.npmjs.com");
  }
  if (wants("Cargo.toml")) {
    add("cargo", "Rust (cargo)", true, "1.79.0", ["Cargo.toml"],
        "winget install --exact --id Rustlang.Rustup", "https://rustup.rs");
  }
  if (wants("pyproject.toml")) {
    add("python", "Python", true, "3.12.4", ["pyproject.toml"],
        "winget install --exact --id Python.Python.3.12", "https://python.org");
  }
  if (wants("go.mod") || project.stack === "Go") {
    add("go", "Go", false, "", ["go.mod"],
        "winget install --exact --id GoLang.Go", "https://go.dev/dl");
  }
  if (project.manifests.some((m) => m.startsWith("docker-compose"))) {
    add("docker", "Docker", true, "27.1.1", ["docker-compose.yml"],
        "winget install --exact --id Docker.DockerDesktop", "https://docs.docker.com/get-docker");
  }
  if (wants("Makefile")) {
    add("make", "GNU Make", false, "", ["Makefile"],
        "winget install --exact --id GnuWin32.Make", "https://www.gnu.org/software/make");
  }
  add("git", "Git", true, "2.45.1", [".git"],
      "winget install --exact --id Git.Git", "https://git-scm.com");

  return out.sort((a, b) => Number(a.found) - Number(b.found) || a.name.localeCompare(b.name));
}

export async function installTool(id: string): Promise<string> {
  const cmd = `winget install --exact --id ${id}`;
  const key = `tools||${cmd}`;

  emit(key, `$ ${cmd}`, "cmd");
  for (const text of ["Found package…", "Downloading…", "Successfully installed"]) {
    await pause(320);
    emit(key, text, "out");
  }
  emit(key, "exit 0", "exit");
  return cmd;
}

// ---------------------------------------------------------------------------
// Git sync
// ---------------------------------------------------------------------------

/** The rest of the team, so "somebody else pushed" has a name on it. */
const AUTHORS = ["Kovács Anna", "Tóth Bence", "Nagy Eszter", "Szabó Márk", "Varga Dóra"];

/** What the others have been committing while this checkout was not looking. */
const INCOMING_MSG = [
  "feat: add invoice export to the reporting screen",
  "fix: retry the upload once before giving up",
  "refactor: pull the session store out of the router",
  "chore: bump the lockfile after the security advisory",
  "fix: stop the sidebar from scrolling the whole page",
  "test: cover the empty-cart checkout path",
];

/** Days since the last fetch, spread so the staleness warning is reachable. */
function mockFetchDays(i: number): number | null {
  if (i % 9 === 4) return null; // never fetched
  return [0, 0, 1, 3, 11, 26][i % 6]!;
}

function mockCommits(seed: number, count: number, from: number): Commit[] {
  return Array.from({ length: Math.min(count, 12) }, (_, k) => ({
    sha: ((seed + 1) * 977_213 + k * 4_231_777).toString(16).padStart(7, "0").slice(0, 7),
    msg: INCOMING_MSG[(seed + k) % INCOMING_MSG.length]!,
    days: from + k,
    date: "",
    author: AUTHORS[(seed + k) % AUTHORS.length]!,
  }));
}

/** Fetches that have already happened this session, by project id. */
const fetched = new Set<string>();

export function syncStatus(projectId: string): SyncStatus {
  const all = projects();
  const i = all.findIndex((p) => p.id === projectId);
  const project = all[i];

  if (!project || !project.git.isRepo) {
    return { ...EMPTY_SYNC, projectId, project: project?.name ?? "", state: "not-a-repo" };
  }

  const { ahead, behind, branch, dirty } = project.git;
  // A project with no remote cannot be behind anything, and saying so is the
  // whole of the answer for it.
  if (!project.git.remote) {
    return { ...EMPTY_SYNC, projectId, project: project.name, branch, dirty, state: "no-remote" };
  }

  const state = ahead > 0 && behind > 0 ? "diverged" : behind > 0 ? "behind" : ahead > 0 ? "ahead" : "ok";
  const incoming = mockCommits(i, behind, 0);

  return {
    projectId,
    project: project.name,
    state,
    branch,
    upstream: `origin/${branch}`,
    ahead,
    behind,
    dirty,
    incoming,
    outgoing: project.git.commits.slice(0, ahead),
    authors: [...new Set(incoming.map((c) => c.author))],
    fetchDays: fetched.has(projectId) ? 0 : mockFetchDays(i),
    conflicts: [],
    error: "",
  };
}

const EMPTY_SYNC: SyncStatus = {
  projectId: "",
  project: "",
  state: "ok",
  branch: "",
  upstream: "",
  ahead: 0,
  behind: 0,
  dirty: 0,
  incoming: [],
  outgoing: [],
  authors: [],
  fetchDays: null,
  conflicts: [],
  error: "",
};

export async function gitFetch(projectId: string): Promise<SyncStatus> {
  await new Promise((r) => setTimeout(r, 700));

  // One project stands in for a remote that cannot be reached, so the error
  // path is reachable in the browser build. It is deliberately not marked as
  // fetched: a failed fetch leaves the counts as stale as it found them, and
  // the dialog has to keep saying so.
  const all = projects();
  if (all.findIndex((p) => p.id === projectId) % 11 === 5) {
    return { ...syncStatus(projectId), error: "fatal: could not read from remote repository" };
  }

  fetched.add(projectId);
  return syncStatus(projectId);
}

export async function gitFetchAll(): Promise<SyncStatus[]> {
  const repos = projects().filter((p) => p.git.isRepo && p.git.remote);
  const out: SyncStatus[] = [];
  for (const project of repos) {
    await new Promise((r) => setTimeout(r, 60));
    fetched.add(project.id);
    out.push(syncStatus(project.id));
  }
  return out;
}

/** Projects whose mock rebase stops on a conflict, so that path is reachable. */
const CONFLICTING = 1;

export async function gitRebase(projectId: string): Promise<RebaseReport> {
  await new Promise((r) => setTimeout(r, 900));
  const before = syncStatus(projectId);
  const all = projects();
  const i = all.findIndex((p) => p.id === projectId);
  const project = all[i];

  if (before.behind === 0) return { outcome: "up-to-date", output: "", conflicts: [], status: before };

  if (i % 7 === CONFLICTING) {
    const conflicts = ["src/store/session.ts", "src/router/index.ts"];
    return {
      outcome: "conflict",
      output: `Auto-merging src/store/session.ts\nCONFLICT (content): Merge conflict in src/store/session.ts\nerror: could not apply ${before.outgoing[0]?.sha ?? "1a2b3c4"}... ${before.outgoing[0]?.msg ?? ""}`,
      conflicts,
      status: { ...before, state: "rebasing", conflicts },
    };
  }

  // The mock projects are a fixed list, so a successful rebase is reflected by
  // moving this one's counts rather than by rebuilding the dataset.
  if (project) {
    project.git.behind = 0;
    project.git.ahead = before.ahead;
  }
  return {
    outcome: before.outgoing.length === 0 ? "fast-forward" : "rebased",
    output: `Successfully rebased and updated refs/heads/${before.branch}.`,
    conflicts: [],
    status: { ...syncStatus(projectId), behind: 0, state: before.ahead > 0 ? "ahead" : "ok" },
  };
}

export async function gitRebaseAbort(projectId: string): Promise<RebaseReport> {
  await new Promise((r) => setTimeout(r, 500));
  return {
    outcome: "aborted",
    output: "",
    conflicts: [],
    status: syncStatus(projectId),
  };
}

// ---------------------------------------------------------------------------
// Claude Code history
// ---------------------------------------------------------------------------

/** A fortnight of sessions across three projects, so the charts have a shape. */
export function claudeStats(): ClaudeStats {
  const all = projects();
  const pick = (name: string) => all.find((p) => p.name === name);
  const day = (back: number, hour: number) =>
    new Date(Date.now() - back * 864e5 - (23 - hour) * 36e5).toISOString();

  const seeds: Array<[project: string, title: string, back: number, msgs: number, tools: number]> = [
    ["ultimate-project-assister", "Claude előzmények nézet", 0, 46, 128],
    ["ultimate-project-assister", "Ablakszélesség igazítás", 1, 22, 61],
    ["shopflow-web", "Kosár összesítő újraírása", 1, 31, 74],
    ["api-gateway", "Rate limit hibakeresés", 3, 18, 40],
    ["shopflow-web", "Checkout teszt lefedettség", 4, 27, 66],
    ["ultimate-project-assister", "Git sync párbeszéd", 6, 39, 96],
    ["ml-playground", "Notebook takarítás", 9, 12, 21],
    ["shopflow-web", "MDX oldalak migrálása", 12, 24, 58],
  ];

  const sessions: ClaudeSession[] = seeds.map(([name, title, back, msgs, tools], i) => {
    const project = pick(name);
    const output = msgs * 620;
    const cacheRead = msgs * 41_000;
    const cacheWrite = msgs * 4_200;
    return {
      id: `mock-session-${i}`,
      title,
      projectId: project?.id ?? "",
      project: project?.name ?? name,
      path: project?.path ?? "",
      branch: project?.git.branch ?? "main",
      startedAt: day(back, 9),
      endedAt: day(back, 9 + Math.min(6, Math.round(msgs / 8))),
      messages: msgs,
      userMessages: Math.round(msgs / 3),
      sidechains: i % 3 === 0 ? 6 : 0,
      toolCalls: tools,
      errors: i % 4,
      tokens: { input: msgs * 90, output, cacheRead, cacheWrite },
      costUsd:
        (msgs * 90 * 5 + cacheWrite * 5 * 1.25 + cacheRead * 5 * 0.1 + output * 25) / 1_000_000,
      models: [
        { name: "claude-opus-5", count: Math.round(msgs * 0.8) },
        { name: "claude-haiku-4-5", count: Math.round(msgs * 0.2) },
      ],
      tools: [
        { name: "Read", count: Math.round(tools * 0.4) },
        { name: "Edit", count: Math.round(tools * 0.25) },
        { name: "Bash", count: Math.round(tools * 0.2) },
        { name: "Grep", count: Math.round(tools * 0.15) },
      ],
      sizeBytes: msgs * 220 * 1024,
    };
  });

  return { available: true, root: "C:\Users\dev\.claude\projects", sessions };
}

export async function claudeSession(id: string): Promise<ClaudeMessage[]> {
  await pause(180);
  const at = (minutes: number) => new Date(Date.now() - (40 - minutes) * 60_000).toISOString();
  const turn = (o: Partial<ClaudeMessage> & { role: ClaudeMessage["role"]; time: string }) => ({
    text: "", tools: [], thinking: false, error: false, sidechain: false, ...o,
  });

  return [
    turn({ role: "user", time: at(0), text: `Nézzük meg a ${id} munkamenetet: mi kell a nézethez?` }),
    turn({ role: "assistant", time: at(1), text: "Megnézem, mit olvas most a nézet.", thinking: true, tools: ["Read", "Grep"] }),
    turn({ role: "assistant", time: at(3), text: "A statisztikát a naplókból számoljuk, nem a beszélgetésből — így egy hosszú munkamenet is olcsó marad." }),
    turn({ role: "user", time: at(5), text: "Jó. A költség legyen becslés, ne számla." }),
    turn({ role: "assistant", time: at(6), text: "Beírom a jelzést a kártyára is.", tools: ["Edit"] }),
    turn({ role: "user", time: at(7), text: "", error: true }),
    turn({ role: "assistant", time: at(8), text: "A teszt elhasalt egy útvonal-elválasztón; javítom.", tools: ["Edit", "Bash"] }),
  ];
}
