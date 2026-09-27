"""A file this repository names in prose or in a message is a file that exists.

This is a regression test for a defect that was already real. For seven parts the execution
engine's own ``503 ENABLEMENT_ROLE_UNKNOWN`` body told an operator to apply "Part 11's
grant.sql", and no such file was ever written: the name was in the message, the intent was in
the part document, and nothing produced the file or looked for it. An error message that sends
a human to a missing artefact is a second incident on top of the first, and it is invisible to
every unit test, because the test asserts the message text and the text was accurate about a
thing nobody built. ``apps/api/prisma/rls/grant.sql`` now exists (generated, like the two
files beside it), and this file is what keeps the class of bug from returning.

The rules, and why each is drawn where it is:

* A token is a claim about a file only when it is delimited by backticks or quotes, and only
  when it carries a suffix from ``ARTEFACT_SUFFIXES``. ``.json`` and ``.jsonl`` are absent from
  that set: those name runtime outputs (a dataset's ``status.json``, a DR ledger), and a string
  describing something the program is about to write is not a pointer a reader can follow today.
* A path resolves from the repository root, or as a trailing match of any file in the tree,
  because the documents in this repository use service-relative shorthand (``src/worker.ts`` for
  ``apps/api/src/worker.ts``) deliberately and everywhere.
* Test files are read for prose only - comments and docstrings - not for string literals. In a
  test, a path in a string is usually input data for a refusal case:
  dr-manifest.test.mjs pushes apps/api/prisma/schema.dreamt-of.prisma into a manifest to prove
  the validator refuses it, and test_part21_red_view.py cites docs/ALERTING.md as a budget's
  source string while Part 21's whole argument is that no such operations document is kept here. Those are correct tests. A path a human is told to open is
  the claim that has to resolve.
* A line that describes a rename is exempt (``HISTORY_MARKERS``). ``docs/PART8_RISK.md`` says the
  single-module ``risk.py`` "became a package", and that sentence is about the tree as it was; a
  check that flags it would be a check that punishes accurate history, and the temptation when a
  law does that is to weaken the law.
* The resolution is a trailing match, not an exact one, and that is a recorded soft spot rather than
  an oversight: this tree's documents address files through their own area (``src/worker.ts`` for
  ``apps/api/src/worker.ts``, ``infrastructure/metrics/metrics.registry.ts`` for the API's twin of the
  core's module), and requiring repo-root-exact paths would mean rewriting a dozen accurate
  sentences into worse prose. The cost is that a wrong file inside a right directory can pass: the
  never-written Part 11 security document was caught only because its basename appears nowhere in the
  tree, and ``docs/SECURITY.md``'s two wrong-directory rows were caught because the whole path was
  quoted. A misspelling beside a real neighbour is the case this check does not see, and tightening it
  means adopting one canonical path form in the documents first - a formatting pass, not a re-argument
  about what the law is for.

* Handover documents, the generated ``docs/source/`` dump, and the generators that emit the
  handovers are exempt on the same ground as history: they are records of a diff at a moment,
  and several name files precisely to say they are absent (Part 11's ``gone.json`` refusal
  fixtures). The inventory documents that describe the tree as it is now - ``README.md``,
  ``docs/SECURITY.md``, the service READMEs - are scanned, and were the ones that had drifted.
"""

from __future__ import annotations

import ast
import io
import re
import tokenize
from pathlib import Path
from typing import Final

REPO: Final[Path] = Path(__file__).resolve().parents[3]
DOCS: Final[Path] = REPO / "docs"

#: Longest first: an alternation that tried `ts` before `tsx` would match the prefix of a
#: `.tsx` path, then fail to find the closing delimiter, and quietly skip every claim about a
#: React component. The order is load-bearing, not cosmetic.
ARTEFACT_SUFFIXES: Final[str] = "pyi|py|tsx|ts|mjs|sql|md|prisma|toml|yaml|yml|sh"
TOKEN: Final[re.Pattern[str]] = re.compile(
    r"[`'\"]((?:[A-Za-z0-9_.\-]+/)*[A-Za-z0-9_.\-]+\.(?:" + ARTEFACT_SUFFIXES + r"))[`'\"]"
)

#: Placeholders, globs, URLs and ellipses are not claims about one named file.
UNRESOLVABLE: Final[tuple[str, ...]] = ("*", "...", "<", ">", "$", "{", "}", "|", "://", "::")

#: Words that mark a sentence as describing a change to the tree rather than pointing into it.
HISTORY_MARKERS: Final[tuple[str, ...]] = (
    "became",
    "before that",
    "previously",
    "no longer",
    "renamed",
    "dropped from",
    "retired",
    "was split",
    "used to",
    "at the time",
    "removed",
    "once was",
)

#: (substring, reason) - skipped as claims, not as corpora. The resolution corpus keeps every
#: file so that a reference to a build artefact still resolves if the artefact exists.
EXEMPT_PATHS: Final[tuple[tuple[str, str], ...]] = (
    ("docs/dr/", "the DR ledgers are written by the operator, and their absence is the finding the tools report"),
    ("/dist/", "build output from `npm run build:packages`, not a source claim"),
    ("node_modules", "third-party"),
    ("HANDOVER_FULL_SOURCE", "a part's handover is a record of that part's diff at that moment"),
    ("docs/source/", "the generated whole-tree dump, whose content is the tree"),
)

#: Files scanned as "prose only" - see the module docstring.
TEST_FILE_MARKERS: Final[tuple[str, ...]] = ("/tests/", ".test.", ".spec.")

SCAN_SUFFIXES: Final[frozenset[str]] = frozenset({".py", ".ts", ".tsx", ".mjs", ".md", ".yml", ".yaml"})
CORPUS_ROOTS: Final[tuple[Path, ...]] = (
    REPO / "libs",
    REPO / "services",
    REPO / "apps",
    REPO / "packages",
    REPO / "scripts",
    REPO / "infrastructure",
)
SKIP_DIRS: Final[frozenset[str]] = frozenset(
    {".mypy_cache", ".ruff_cache", ".pytest_cache", "node_modules", "dist", "__pycache__", ".venv", "build"}
)


def is_excluded(rel: str, parts: tuple[str, ...]) -> bool:
    return any(marker in rel for marker, _ in EXEMPT_PATHS) or bool(SKIP_DIRS & set(parts))


def is_test_file(rel: str) -> bool:
    return any(marker in rel for marker in TEST_FILE_MARKERS)


JS_COMMENT_PREFIXES: Final[tuple[str, ...]] = ("//", "*", "/*", "*/")


def prose_lines(path: Path, text: str) -> set[int] | None:
    """For a test file, the line numbers that are prose (comments or a docstring).

    Returns ``None`` for every other kind of file, meaning "scan all lines": a path in a
    production string is what an operator reads, and a path in a document is a pointer by
    definition. Python gets the real tokenizer plus the docstring spans from the syntax tree;
    TypeScript and JavaScript have no docstrings, so a line whose first characters are a comment
    marker is the whole of what counts as prose there.
    """
    if not is_test_file(rel_path(path)):
        return None
    lines: set[int] = set()
    if path.suffix in {".ts", ".tsx", ".mjs", ".js"}:
        for lineno, line in enumerate(text.splitlines(), 1):
            if line.strip().startswith(JS_COMMENT_PREFIXES):
                lines.add(lineno)
        return lines or None
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT:
                lines.update(range(tok.start[0], tok.end[0] + 1))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        # An unparsable Python file has no comments to find this way, and the reference check
        # must not become a parser test: the syntax error is another gate's business.
        pass
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return lines or None
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            body = getattr(node, "body", [])
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant):
                if isinstance(body[0].value.value, str):
                    lines.update(range(body[0].lineno, (body[0].end_lineno or body[0].lineno) + 1))
    return lines or None


def rel_path(path: Path) -> str:
    return path.relative_to(REPO).as_posix()


def all_tree_paths() -> list[str]:
    return [
        rel_path(path)
        for path in REPO.rglob("*")
        if path.is_file() and not (SKIP_DIRS & set(path.parts))
    ]


def scanned_files() -> list[Path]:
    found: list[Path] = []
    for root in CORPUS_ROOTS:
        for path in sorted(root.rglob("*")):
            if not path.is_file() or path.suffix not in SCAN_SUFFIXES:
                continue
            rel = rel_path(path)
            if is_excluded(rel, path.parts) or is_handover_generator(rel):
                continue
            found.append(path)
    for path in sorted(DOCS.glob("*.md")):
        rel = rel_path(path)
        if not is_excluded(rel, path.parts):
            found.append(path)
    for extra in (REPO / "README.md", REPO / "infrastructure/observability/README.md"):
        if extra.exists():
            found.append(extra)
    return found


def is_handover_generator(rel: str) -> bool:
    """The scripts that emit a part's handover enumerate that part's diff, which is history."""
    return bool(re.match(r"scripts/gen_part\d+_handover\.py$", rel))


def resolves(token: str, corpus: list[str]) -> bool:
    """Whether a named path is in the tree - file or directory.

    Directory tokens are legal because the inventories in this repository name directories
    (`risk/`, `infrastructure/observability/`) as the unit of meaning, and a check that could
    only see files would push a document toward naming one file inside a directory and going
    stale the moment the directory grows.
    """
    token = token[2:] if token.startswith("./") else token
    trimmed = token.rstrip("/")
    if (REPO / trimmed).exists():
        return True
    needle = "/" + trimmed
    return any(
        candidate == trimmed or candidate.endswith(needle + "/") or candidate.endswith(needle)
        for candidate in corpus
    )


BARE_PATH: Final[re.Pattern[str]] = re.compile(
    r"(?<![A-Za-z0-9_./-])((?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\.(?:" + ARTEFACT_SUFFIXES + r"))"
)


def claims_in(path: Path, text: str) -> list[tuple[int, str]]:
    """The path claims in one file.

    Markdown gets a second, unquoted scan because a document puts paths in fenced code blocks and
    in plain sentences as often as in backticks, and a comment inside a ```ts fence is exactly as
    load-bearing as one in prose. Requiring a directory separator keeps it off bare filenames,
    which in markdown are usually talking about a kind of file rather than pointing at one.
    """
    allowed = prose_lines(path, text)
    out: list[tuple[int, str]] = []
    for lineno, line in enumerate(text.splitlines(), 1):
        if allowed is not None and lineno not in allowed:
            continue
        lowered = line.lower()
        if any(marker in lowered for marker in HISTORY_MARKERS):
            continue
        seen: set[str] = set()
        scanners = [TOKEN] + ([BARE_PATH] if path.suffix == ".md" else [])
        for scanner in scanners:
            for match in scanner.finditer(line):
                token = match.group(1)
                if token in seen:
                    continue
                if match.start(1) > 0 and line[match.start(1) - 1] == "$":
                    # `$wlctRoot/scripts/dr-manifest.mjs` in a cron line is a shell expansion with
                    # its definition one line above it, not a path this repository can resolve.
                    continue
                if any(marker in token for marker in UNRESOLVABLE):
                    continue
                if Path(token).name.startswith("."):
                    continue
                seen.add(token)
                out.append((lineno, token))
    return out


def test_the_scanned_corpus_is_big_enough_to_be_a_law() -> None:
    # A reference check that quietly scanned nothing would pass forever, so its reach is
    # asserted before its verdict is read: the whole monorepo's source plus the living documents.
    files = scanned_files()
    assert len(files) > 600, f"the reference check reached {len(files)} files, which is not this tree"
    documents = [f for f in files if rel_path(f).startswith("docs/") or f.name == "README.md"]
    assert len(documents) >= 12, f"only {len(documents)} documents were reached"


def test_every_named_artefact_resolves_to_a_file_in_the_tree() -> None:
    corpus = all_tree_paths()
    broken: list[str] = []
    for path in scanned_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        for lineno, token in claims_in(path, text):
            if not resolves(token, corpus):
                broken.append(f"{rel_path(path)}:{lineno} names {token}")
    assert not broken, (
        "files named by a comment, a message or a document that do not exist in the tree "
        "(add the artefact, or correct the name it was given):\n" + "\n".join(sorted(broken))
    )


def test_the_grant_the_enablement_refusal_sends_an_operator_to_is_in_the_tree() -> None:
    # The claim that started this file, pinned by name so that removing the file fails here with
    # a sentence about why it exists rather than as one line among a walk of the tree.
    message = (REPO / "services/execution-engine/app/routers/enablement.py").read_text(encoding="utf-8")
    assert "grant.sql" in message, "the enablement refusal no longer points at the grant file"
    grant = REPO / "apps/api/prisma/rls/grant.sql"
    assert grant.exists(), "the refusal names apps/api/prisma/rls/grant.sql, which is not in the tree"
    body = grant.read_text(encoding="utf-8")
    assert "GRANT SELECT ON pg_catalog.pg_roles" in body
    assert "REVOKE SELECT ON pg_catalog.pg_roles" in body, "a grant with no stated inverse is a one-way door"
    # What this file must never do is hand the audit the privilege it exists to detect.
    actionable = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("--"))
    assert "BYPASSRLS" not in actionable.upper() and "SUPERUSER" not in actionable.upper()
    assert not re.search(r"^\s*GRANT(?![^;]*pg_roles)", actionable, re.M | re.I), "grant.sql grants something else"


def test_the_rls_directory_stays_reproducible_from_the_one_generator() -> None:
    # `grant.sql` joined a directory that is rendered from schema.prisma. A hand-written file in
    # it would be the one file a rerun neither overwrites nor notices, so membership is checked
    # by the banner each file carries and by the generator that writes it.
    rls = REPO / "apps/api/prisma/rls"
    generator = (REPO / "scripts/gen_part11_rls.py").read_text(encoding="utf-8")
    files = sorted(rls.iterdir())
    assert [f.name for f in files] == ["disable.sql", "enable.sql", "grant.sql", "rls_coverage.json"]
    for sql in (f for f in files if f.suffix == ".sql"):
        first = sql.read_text(encoding="utf-8").splitlines()[0]
        assert "gen_part11_rls.py" in first, f"{sql.name} sits in a generated directory without the banner"
        assert f'"{sql.name}"' in generator, f"{sql.name} is not written by the generator that owns the directory"
