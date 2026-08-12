// Browser-mode sample data.
//
// This is the design's own dataset, reshaped into the runtime types. It only
// ever runs when the UI is opened outside Tauri (`npm run dev:vite`), so the
// layout can be worked on without scanning a real disk.

import type {
  CleanProgress,
  CleanTarget,
  CommandDef,
  DeleteReport,
  Goal,
  LogLine,
  Note,
  Project,
  Settings,
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

function commandsFor(name: string, stack: string, cwd = ""): CommandDef[] {
  const out: CommandDef[] = [];
  const add = (kind: CommandDef["kind"], n: string, cmd: string) =>
    out.push({ kind, name: n, cmd, cwd, part: cwd || name });

  switch (stack) {
    case "Rust":
      add("cargo", "dev run", "cargo run");
      add("cargo", "release build", "cargo build --release");
      add("cargo", "test", "cargo test --all");
      add("cargo", "clippy", "cargo clippy -- -D warnings");
      break;
    case "TypeScript":
    case "Node":
    case "Astro":
      add("npm", "dev", "npm run dev");
      add("npm", "build", "npm run build");
      add("npm", "lint", "npm run lint");
      add("npm", "test", "npm run test");
      break;
    case "Python":
      add("py", "serve", "uvicorn app:api --reload");
      add("py", "tests", "pytest -q");
      break;
    case "Go":
      add("make", "run", "go run ./...");
      add("docker", "stack up", "docker compose up -d");
      break;
    case "Docker":
    case "YAML":
      add("docker", "stack up", "docker compose up");
      add("docker", "stack down", "docker compose down -v");
      add("docker", "prune", "docker system prune -f");
      break;
    case "Dart":
      add("make", "run android", "flutter run -d android");
      add("make", "build apk", "flutter build apk");
      break;
    case "PHP":
      add("make", "serve", "php -S localhost:8000 -t public");
      break;
    case "C++":
    case "Elixir":
      add("make", "build", "make build");
      add("make", "run", "make run");
      break;
    default:
      break;
  }

  if (name === "shopflow-web" && !cwd) {
    add("docker", "db + redis", "docker compose up -d db redis");
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
    toggles: { scanStart: true, watchFs: true, deepGit: true, docker: false },
    ageDays: 30,
    rules: [
      { pattern: "node_modules", scope: "keep: shopflow-web" },
      { pattern: "*.sqlite", scope: "never delete" },
      { pattern: "target/release", scope: "only after 90 days" },
      { pattern: ".venv", scope: "keep: hu-nyelvtan-api" },
    ],
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
  const [project = "", , cmd = ""] = key.split("|");
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

export async function runCommand(projectId: string, cmd: string, cwd = ""): Promise<void> {
  const project = projects().find((p) => p.id === projectId)?.name ?? projectId;
  const key = `${project}|${cwd}|${cmd}`;
  running.add(key);
  emit(key, `$ ${cmd}  (${project}${cwd ? `/${cwd}` : ""})`, "cmd");
}

export async function stopCommand(projectId: string, cmd: string, cwd = ""): Promise<void> {
  const project = projects().find((p) => p.id === projectId)?.name ?? projectId;
  const key = `${project}|${cwd}|${cmd}`;
  running.delete(key);
  emit(key, `^C  ${cmd} stopped`, "exit");
}

export async function runningCommands(): Promise<string[]> {
  return [...running];
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

  // Step through the targets so the progress UI has something to show.
  let freed = 0;
  for (const [i, target] of hit.entries()) {
    emitClean({ phase: "delete", done: i, total: hit.length, current: target.path, freedBytes: freed });
    await pause(160);
    freed += target.bytes;
  }
  emitClean({ phase: "rescan", done: 0, total: 1, current: "", freedBytes: freed });
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

  emitClean({ phase: "done", done: 1, total: 1, current: "", freedBytes: freed });

  return { freedBytes: freed, removed: hit.map((t) => t.path), errors: [] };
}
