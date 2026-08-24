# The GitHub side

The app reads every repository on the disk already. This is the half only the
server can answer: whether the build passed, what is deployed where, what is
waiting for review, and the housekeeping a checkout cannot show.

Everything here is read-only unless a command says otherwise, and every request
is built from a project's own remote — **the frontend names a project, never a
URL**.

---

## How it talks to GitHub

Through the [`gh` CLI](https://cli.github.com), not an HTTP client of our own.

| | Why |
| --- | --- |
| **The token stays where it is** | `gh auth login` already stored one. This app never holds a secret, never writes one to `settings.json`, and cannot leak one it does not have. |
| **No OAuth dance** | No GitHub App, no callback server, no refresh handling. |
| **No new dependency** | No TLS stack in the binary for a feature many users will not switch on. |

What it costs is a program having to be installed. That is an ordinary state
which the UI reports the way it reports a missing Docker daemon — with a
sentence and the command that fixes it (`gh auth login`).

`src-tauri/src/github/gh.rs` is the whole transport, and it is small on
purpose: `gh api -i` for REST (the `-i` keeps the status line and the headers,
which is where the ETag and the rate limit live) and `gh run view --log-failed`
for logs, because those come back as a zip that has to be unpacked and stitched
and `gh` already does exactly that. A different transport — `reqwest` with a
token from the OS keychain — can be dropped in behind the same two methods
without a view noticing.

## Rate limits, and why refreshing is cheap

Five thousand requests an hour sounds generous until thirty projects are asked
about repeatedly. Two things keep it from mattering:

- **Conditional requests.** Every answer is kept with its `ETag`, and the next
  ask sends `If-None-Match`. A `304` costs **nothing** against the allowance.
- **A time-to-live per kind of question.** Runs are asked at most every 45
  seconds, environments and releases every five minutes, a repository's own
  facts every half hour, and search — which has an allowance of its own, thirty
  a minute — every two minutes.

Polling follows from that: the Actions view refreshes itself only while
something is actually running, and stops the moment everything has finished,
because the answer would not change.

## What is asked, and when

| Question | Endpoint | Asked |
| --- | --- | --- |
| Who am I, what is left of the allowance | `/rate_limit`, `/user` | Once the projects are known |
| Build state per project | `/repos/{o}/{r}/actions/runs` | Same sweep; polled while a run is in flight |
| Environments and what is live in them | `/environments`, `/deployments`, `/deployments/{id}/statuses` | Same sweep — but the first call answers "none" for the price of one conditional request, and most repositories stop there |
| Pull requests | `/search/issues` ×2 | Only when the list is opened |
| A repository's housekeeping | `/repos/{o}/{r}`, `/branches/{b}/protection`, `/actions/secrets`, billing | Only for the project on screen |
| Releases | `/repos/{o}/{r}/releases` | Only for the project on screen |
| A failed run's log | `gh run view --log-failed` | Only when the Log button is pressed |

## The two and a half writes

Everything else is reading. What this app will ask GitHub to *do* is a closed
set, and each one needs a second press to confirm:

- **Re-run the failed jobs** of a run — not the whole run, since the green jobs
  cost minutes to repeat and prove nothing.
- **Cancel** a run that is going.
- **Draft a release** from a `CHANGELOG.md` section. A *draft*: this app can do
  the typing, but publishing is an announcement, and announcements stay the
  user's to make. The draft opens on GitHub for them to read and publish — or
  throw away, which costs nothing and tells nobody.

The run id is checked against the project's own repository before either of the
first two runs, so a caller cannot name a run belonging to somebody else.

## Where it shows up

- **Projects** — a dot before the name, drawn only when GitHub has actually
  been asked about that project. A column would stand empty for everything
  without a remote, and an empty column asks a question it cannot answer.
- **Actions** — the remote half of the Running view: runs grouped by project,
  whatever is going at the top, then the failures. Environments as pills in the
  group headers. A filter switches the body to the pull requests waiting on you.
- **Project detail** — a Repo card (visibility, licence, topics, branch
  protection, secret names, Actions minutes) and an Actions card with the last
  few runs. When there is nothing to show, the workflows read off the disk are
  listed instead: a workflow that has never run is a fact too, and seeing it
  needs nobody's permission.
- **Changelog** — each version says `released`, `draft`, or offers to prepare
  one.
- **Sync window** — before pulling somebody else's commits in, whether the last
  run on the remote passed.
- **Claude** — a session row carries the build state of the branch it worked
  on. The session says what was done; the dot says whether it survived CI.

## States that are not failures

Each of these is an ordinary answer with a sentence, never an error toast:

no remote · a remote that is not GitHub · a private repository the token cannot
see · Actions disabled on a fork · a repository with no environments · a
repository with no runs yet · branch protection the token may not ask about
(distinguished from *not protected*, because those differ) · billing the token
may not see · the allowance run out · no network · `gh` not installed · `gh`
installed but logged out.

## Testing

Parsing is pure functions over saved JSON, so the suite touches no network. The
transport is the only part that shells out, and it is one file behind two
methods — a fake is enough to exercise everything above it.

## What is deliberately not here

- **Publishing** a release, deleting anything, editing an issue or a comment.
- **A second service.** GitHub Enterprise works (the host comes from the
  remote, and `gh` is told about it); GitLab and Gitea do not, and would want
  their own transport behind the same shapes rather than `if` branches.
- **Webhooks or a background daemon.** This is a dashboard you open, not a
  service that watches your repositories while it is closed.
