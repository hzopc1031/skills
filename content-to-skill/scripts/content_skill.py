"""Content-to-skill file helpers. Standard library only; synthesis belongs to the agent."""
from __future__ import annotations

import argparse
import ast
import hashlib
import ipaddress
import json
import re
import shutil
import socket
import sys
import uuid
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, quote, unquote, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

sys.dont_write_bytecode = True
VERSION = "1.0.1"
DEFAULT_ROOT = Path.home() / (".dsh" if sys.platform == "win32" else ".agents") / "skills"
MAX_BYTES = 8 * 1024 * 1024
NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
SOURCE_ID = re.compile(r"src-[a-f0-9]{20}\Z")
SECTION_ID = re.compile(r"s\d{3,}\Z")
RISK = re.compile(
    r"ignore\s+(?:all\s+|the\s+)?(?:previous|prior|above)\s+(?:instructions|rules)"
    r"|忽略(?:所有|之前|此前|以上|先前).{0,8}(?:规则|指令)"
    r"|(?:curl|wget|Invoke-WebRequest)\b[^\n]*\|\s*(?:bash|sh|iex|powershell)\b"
    r"|[\u202a-\u202e\u2066-\u2069]", re.I)
EXCLUDED = {"acceptance.json", ".content-to-skill-install.json", "validation.json"}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.name + ".tmp-" + uuid.uuid4().hex)
    temp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temp.replace(path)


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def linked(path: Path) -> bool:
    return path.is_symlink() or getattr(path, "is_junction", lambda: False)()


def within(path: Path, root: Path) -> Path:
    result, base = path.resolve(), root.resolve()
    if result == base or not result.is_relative_to(base):
        raise ValueError("path must stay below its intended directory")
    return result


def relative_file(root: Path, value: str) -> Path:
    if not isinstance(value, str) or not value or Path(value).is_absolute() or re.match(r"^[A-Za-z]:", value):
        raise ValueError("expected a package-relative evidence path")
    path = within(root / value, root)
    if not path.is_file():
        raise ValueError(f"missing referenced file: {value}")
    # Resolve containment above; reject links even when their destination is inside.
    cursor = root / value
    while cursor != root:
        if linked(cursor):
            raise ValueError("links are not allowed in packages")
        cursor = cursor.parent
    return path


def package_files(root: Path, runtime_only: bool = False) -> list[Path]:
    root = root.resolve()
    files = []
    for item in root.rglob("*"):
        if linked(item):
            raise ValueError("links are not allowed in packages")
        if item.is_file():
            rel = item.relative_to(root)
            if ".git" in rel.parts or ".env" == item.name or item.suffix == ".pyc" or "__pycache__" in rel.parts:
                raise ValueError("package contains credentials/config or build artifacts")
            if runtime_only and (item.name in EXCLUDED or rel.parts[0] == "checks"):
                continue
            files.append(item)
    return sorted(files)


def fingerprint(root: Path, runtime_only: bool = True) -> str:
    pairs = [(p.relative_to(root.resolve()).as_posix(), sha(p.read_bytes()))
             for p in package_files(root, runtime_only)]
    return sha(json.dumps(pairs, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))


def decode(data: bytes, encoding: str | None = None) -> str:
    if encoding:
        return data.decode(encoding)
    for mark, codec in ((b"\xff\xfe\x00\x00", "utf-32"), (b"\x00\x00\xfe\xff", "utf-32"),
                        (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16"), (b"\xef\xbb\xbf", "utf-8-sig")):
        if data.startswith(mark):
            return data.decode(codec)
    return data.decode("utf-8")


def x_url(url: str) -> bool:
    return (urlsplit(url).hostname or "").lower() in {"x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"}


def validate_url(url: str) -> None:
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("expected a public HTTP(S) URL without credentials")
    if parsed.port not in {None, 80 if parsed.scheme == "http" else 443}:
        raise ValueError("only standard HTTP(S) ports are supported")
    if any(k.lower() in {"token", "api_key", "apikey", "access_token", "password", "signature", "auth"}
           for k, _ in parse_qsl(parsed.query)):
        raise ValueError("credential-like URL parameters are not accepted")
    addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("private/local network URLs are not supported; import a local text file instead")


class CheckedRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_url(newurl)
        if x_url(newurl):
            raise ValueError("needs_content: X content must be imported without changing scope")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch_url(url: str) -> tuple[bytes, str, str, str | None]:
    if x_url(url):
        raise ValueError("needs_content: import the post/thread text with --origin; no account collection is performed")
    validate_url(url)
    request = Request(url, headers={"User-Agent": "content-to-skill/" + VERSION,
                                   "Accept": "text/html,text/plain,text/markdown"})
    try:
        with build_opener(CheckedRedirect()).open(request, timeout=20) as response:
            mime = response.headers.get_content_type()
            if mime not in {"text/html", "text/plain", "text/markdown", "application/xhtml+xml"}:
                raise ValueError("unsupported response type; use an authorized converter and import text")
            data = response.read(MAX_BYTES + 1)
            if len(data) > MAX_BYTES:
                raise ValueError("source exceeds the 8 MiB limit")
            return data, mime, response.geturl(), response.headers.get_content_charset()
    except HTTPError as error:
        raise ValueError(f"HTTP {error.code}; import available text without bypassing access restrictions") from None
    except URLError:
        raise ValueError("public page request failed; no browser or credential fallback was attempted") from None


class ArticleHTML(HTMLParser):
    """Conservative text extraction, not a renderer or a universal reader-mode engine."""
    def __init__(self, base: str):
        super().__init__(convert_charrefs=True)
        self.base, self.stack = base, []
        self.parts = {"all": [], "main": [], "article": []}
        self.meta, self.title_parts, self.gaps = {}, [], set()

    def emit(self, text: str) -> None:
        if any(tag in {"script", "style", "nav", "aside", "footer", "noscript", "template"} for tag in self.stack):
            return
        if "title" in self.stack:
            self.title_parts.append(text)
            return
        self.parts["all"].append(text)
        for name in ("main", "article"):
            if name in self.stack:
                self.parts[name].append(text)

    def handle_starttag(self, tag, attrs):
        attr = dict(attrs)
        if tag == "meta":
            key = attr.get("property", attr.get("name", "")).lower()
            if key in {"author", "article:published_time", "og:title"}:
                self.meta[key] = attr.get("content", "")
        if tag in {"p", "div", "section", "article", "main", "table", "tr", "blockquote"}:
            self.emit("\n\n")
        if re.fullmatch(r"h[1-6]", tag):
            self.emit("\n\n" + "#" * int(tag[1]) + " ")
        if tag == "li":
            self.emit("\n- ")
        if tag in {"td", "th"}:
            self.emit(" | ")
            self.gaps.add("table_layout_not_rendered")
        if tag == "br":
            self.emit("\n")
        if tag == "pre":
            self.emit("\n\n```\n")
        if tag == "img":
            self.gaps.add("images_not_read")
            self.emit("[图片未读取：" + attr.get("alt", "无说明") + "]")
        if tag in {"iframe", "video", "canvas", "svg"}:
            self.gaps.add("embedded_or_visual_content_not_read")
        if tag == "a":
            href = urljoin(self.base, attr.get("href", ""))
            self.emit("[")
            attr["resolved_href"] = href if urlsplit(href).scheme in {"http", "https"} else ""
        if tag not in {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"}:
            self.stack.append(tag)
            if tag == "a":
                self.stack.append("href=" + attr["resolved_href"])

    def handle_endtag(self, tag):
        href = ""
        if tag == "a" and self.stack and self.stack[-1].startswith("href="):
            href = self.stack.pop()[5:]
        if tag in self.stack:
            position = len(self.stack) - 1 - self.stack[::-1].index(tag)
            del self.stack[position:]
        if tag == "a":
            self.emit("](" + href + ")" if href else "]")
        if tag == "pre":
            self.emit("\n```\n\n")
        if tag in {"p", "div", "section", "article", "main", "tr", "blockquote"} or re.fullmatch(r"h[1-6]", tag):
            self.emit("\n\n")

    def handle_data(self, data):
        if "pre" not in self.stack:
            data = re.sub(r"\s+", " ", data)
        self.emit(data)

    def result(self) -> tuple[str, dict, list[str]]:
        text = next(("".join(self.parts[key]) for key in ("article", "main", "all")
                     if "".join(self.parts[key]).strip()), "")
        text = re.sub(r"\n[ \t]+", "\n", text)
        title = self.meta.get("og:title") or "".join(self.title_parts).strip()
        return text.strip() + "\n", {"title": title, "author": self.meta.get("author"),
                                     "published": self.meta.get("article:published_time")}, sorted(self.gaps)


def content_units(text: str) -> int:
    return len(re.findall(r"[\u3400-\u9fff\U00020000-\U0002fa1f]|[A-Za-z0-9_]+|[^\s\w]", text))


def split_sections(text: str, budget: int = 1400) -> list[dict]:
    chunks, buffer, title, fence = [], [], "正文", None

    def flush():
        nonlocal buffer
        body = "".join(buffer)
        if body.strip():
            chunks.append({"title": title, "text": body})
        buffer = []

    for line in text.splitlines(keepends=True):
        marker = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if marker:
            run = marker.group(1)
            if fence is None:
                if content_units("".join(buffer)) >= budget:
                    flush()
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence):
                fence = None
            buffer.append(line)
            continue
        heading = re.match(r"^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$", line) if fence is None else None
        if heading:
            flush()
            title = heading.group(1)
        if fence is None and content_units(line) > budget:
            flush()
            # Character slicing is conservative for mixed languages and never drops a tail.
            for start in range(0, len(line), budget):
                buffer.append(line[start:start + budget])
                flush()
            continue
        buffer.append(line)
        if fence is None and not line.strip() and content_units("".join(buffer)) >= budget:
            flush()
    flush()
    return [{"id": f"s{i:03d}", **part} for i, part in enumerate(chunks, 1)]


def source_record(work: Path, source_id: str) -> tuple[Path, dict]:
    if not SOURCE_ID.fullmatch(source_id):
        raise ValueError("invalid source ID")
    directory = within(work / "sources" / source_id, work)
    record = read_json(directory / "source.json")
    if record.get("id") != source_id:
        raise ValueError("source identity mismatch")
    if sha((directory / "source.md").read_bytes()) != record["content_sha256"]:
        raise ValueError("source content changed since ingestion")
    return directory, record


def ingest(args) -> tuple[dict, int]:
    work = Path(args.work).resolve()
    if len(args.inputs) != 1 and any((args.origin, args.title, args.author, args.published)):
        raise ValueError("metadata overrides require a single input")
    manifest_path = work / "manifest.json"
    manifest = read_json(manifest_path) if manifest_path.exists() else {"schema_version": 1, "sources": []}
    results = []
    for source in args.inputs:
        try:
            is_url = source.startswith(("https://", "http://"))
            if is_url and x_url(source):
                raise ValueError("needs_content: import this post/thread's text with --origin; scope is unchanged")
            if is_url and not args.refresh and not any((args.origin, args.title, args.author, args.published, args.encoding)):
                cached = next((item for item in reversed(manifest["sources"]) if item["requested"] == source), None)
                if cached:
                    source_record(work, cached["id"])
                    results.append({"id": cached["id"], "cached": True})
                    continue
            gaps, meta, final = [], {}, None
            if is_url:
                raw, mime, final, charset = fetch_url(source)
                original = decode(raw, args.encoding or charset)
                html = mime in {"text/html", "application/xhtml+xml"}
                location = source
                gaps.append("page_completeness_requires_agent_review")
            elif source == "-":
                original = sys.stdin.read(MAX_BYTES + 1)
                raw, html, location = original.encode("utf-8"), False, "stdin"
                if len(raw) > MAX_BYTES:
                    raise ValueError("source exceeds the 8 MiB limit")
            else:
                path = Path(source).resolve()
                if path.suffix.lower() not in {".md", ".markdown", ".txt", ".html", ".htm"}:
                    raise ValueError("unsupported format; first convert to Markdown/text with an authorized reader")
                if path.stat().st_size > MAX_BYTES:
                    raise ValueError("source exceeds the 8 MiB limit")
                raw = path.read_bytes()
                original = decode(raw, args.encoding)
                html, location = path.suffix.lower() in {".html", ".htm"}, path.as_uri()
            origin = args.origin or final or location
            if args.origin:
                parsed = urlsplit(args.origin)
                if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password:
                    raise ValueError("--origin must be an HTTP(S) attribution URL without credentials")
                if any(k.lower() in {"token", "api_key", "apikey", "access_token", "password", "signature", "auth"}
                       for k, _ in parse_qsl(parsed.query)):
                    raise ValueError("credential-like attribution parameters are not accepted")
            if html:
                parser = ArticleHTML(origin)
                parser.feed(original)
                content, meta, extra = parser.result()
                gaps.extend(extra)
            else:
                content = original.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
                if re.search(r"!\[[^\]]*\]\(", content):
                    gaps.append("images_not_read")
            if not content.strip():
                raise ValueError("no readable text; nothing was saved")
            if x_url(origin):
                gaps.append("X_import_completeness_requires_agent_review")
            if RISK.search(original):
                gaps.append("instruction_or_command_signal_requires_agent_review")
            identity = json.dumps([VERSION, location, origin, sha(raw), args.title, args.author, args.published], ensure_ascii=False)
            source_id = "src-" + sha(identity.encode("utf-8"))[:20]
            directory = work / "sources" / source_id
            parts = split_sections(content)
            heading = re.search(r"^#\s+(.+)$", content, re.M)
            title = args.title or meta.get("title") or (heading.group(1) if heading else Path(source).name if not is_url else urlsplit(source).hostname)
            record = {"schema_version": 1, "converter_version": VERSION, "id": source_id,
                      "requested": location, "origin": origin, "final_url": final,
                      "title": title or "未命名正文", "author": args.author or meta.get("author"),
                      "published": args.published or meta.get("published"), "captured_at": now(),
                      "original_sha256": sha(raw), "content_sha256": sha(content.encode("utf-8")),
                      "content_units": content_units(content), "gaps": sorted(set(gaps)), "sections": []}
            if directory.exists():
                source_record(work, source_id)
            else:
                (directory / "sections").mkdir(parents=True)
                (directory / "original.txt").write_text(original, encoding="utf-8", newline="")
                (directory / "source.md").write_text(content, encoding="utf-8", newline="")
                for part in parts:
                    rel = "sections/" + part["id"] + ".md"
                    (directory / rel).write_text(part["text"], encoding="utf-8", newline="")
                    cite = origin + ("#:~:text=" + quote(part["title"], safe="") if origin.startswith(("https://", "http://")) and "#" not in origin else "")
                    record["sections"].append({"id": part["id"], "title": part["title"], "file": rel,
                                               "sha256": sha(part["text"].encode("utf-8")), "citation": cite})
                write_json(directory / "source.json", record)
            if not any(item["id"] == source_id for item in manifest["sources"]):
                manifest["sources"].append({"id": source_id, "requested": location})
            write_json(manifest_path, manifest)
            results.append({"id": source_id, "path": str(directory), "gaps": record["gaps"], "cached": False})
        except (ValueError, OSError, UnicodeError, LookupError) as error:
            # No URL is echoed on failure: input may itself contain credentials.
            results.append({"error": str(error) if not isinstance(error, UnicodeError) else "decode failed; provide --encoding explicitly"})
    return {"results": results}, int(any("error" in item for item in results))


def catalog(work: Path) -> dict:
    result = []
    for item in read_json(work / "manifest.json")["sources"]:
        directory, rec = source_record(work, item["id"])
        result.append({key: rec[key] for key in ("id", "title", "origin", "content_units", "gaps", "sections")}
                      | {"directory": str(directory)})
    return {"sources": result}


def parse_frontmatter(text: str) -> tuple[dict, str]:
    text = text.lstrip("\ufeff").replace("\r\n", "\n")
    match = re.match(r"\A---\n(.*?)\n---(?:\n|$)", text, re.S)
    if not match:
        raise ValueError("missing delimited frontmatter")
    fields = {}
    for line in match.group(1).splitlines():
        if not line.strip():
            continue
        field = re.fullmatch(r"(name|description):\s*(.+)", line)
        if not field or field.group(1) in fields:
            raise ValueError("unsupported frontmatter; use name and a single-line quoted description")
        key, value = field.groups()
        if value.startswith('"'):
            value = json.loads(value)
        elif value.startswith("'") and value.endswith("'"):
            value = value[1:-1].replace("''", "'")
        elif ": " in value or value.startswith(("|", ">", "[", "{")):
            raise ValueError("quote the single-line frontmatter value")
        elif value.lower() in {"true", "false", "null", "~"} or re.fullmatch(r"[-+]?\d+(?:\.\d+)?", value):
            raise ValueError("quote scalar values that YAML would treat as non-string")
        if not isinstance(value, str) or not value.strip():
            raise ValueError("frontmatter strings must be nonempty")
        fields[key] = value
    if set(fields) != {"name", "description"} or not NAME.fullmatch(fields["name"]) or len(fields["name"]) > 64:
        raise ValueError("invalid name or missing required frontmatter")
    if len(fields["description"]) > 1024:
        raise ValueError("description exceeds 1024 characters")
    return fields, text[match.end():]


def find_skills(root: Path, query: str) -> dict:
    words = set(re.findall(r"[a-z0-9_-]+|[\u3400-\u9fff]", query.lower()))
    results = []
    for path in root.glob("*/SKILL.md"):
        if linked(path.parent) or linked(path):
            continue
        text = path.read_text(encoding="utf-8-sig")
        desc = re.search(r"^description:\s*(.+)$", text, re.M)
        haystack = path.parent.name + " " + (desc.group(1) if desc else "")
        score = sum(1 for word in words if word in haystack.lower())
        if score:
            results.append({"name": path.parent.name, "description": desc.group(1) if desc else "", "path": str(path), "keyword_score": score})
    return {"matches": sorted(results, key=lambda item: (-item["keyword_score"], item["name"]))[:10],
            "note": "Keyword candidates only; the agent must compare capabilities semantically."}


def draft(args) -> dict:
    if not NAME.fullmatch(args.name) or len(args.name) > 64:
        raise ValueError("invalid skill name")
    work = Path(args.work).resolve()
    sources = list(dict.fromkeys(args.source))
    records = [source_record(work, source_id)[1] for source_id in sources]
    target = within(work / "candidates" / args.name, work)
    if target.exists():
        raise ValueError("candidate already exists; read and edit it explicitly")
    target.mkdir(parents=True)
    (target / "references").mkdir()
    text = f"---\nname: {json.dumps(args.name)}\ndescription: {json.dumps(args.description, ensure_ascii=False)}\n---\n\n# {args.name}\n\nTODO: agent must write the reusable procedure, inputs, prerequisites and observable acceptance.\n\n来源：[资料出处](references/sources.md)。\n"
    (target / "SKILL.md").write_text(text, encoding="utf-8", newline="")
    links = ["# 资料出处\n\n原始正文及分段保留在转换工作目录；此文件仅保留归属与出处。\n"]
    for rec in records:
        origin = rec["origin"] if rec["origin"].startswith(("https://", "http://")) else "本地资料，原件保留于转换工作目录"
        links.append(f"\n- {rec['id']}：{rec['title']}；{origin}；作者：{rec['author'] or '未知'}；日期：{rec['published'] or '未知'}。\n")
    (target / "references" / "sources.md").write_text("".join(links), encoding="utf-8", newline="")
    write_json(target / "evidence.json", {"schema_version": 1, "managed_by": "content-to-skill", "mode": args.mode,
                                         "sources": sources, "claims": [], "dependencies": [],
                                         "known_gaps": sorted({gap for rec in records for gap in rec["gaps"]})})
    return {"candidate": str(target), "status": "scaffold_needs_agent_synthesis"}


def validate(candidate: Path, work: Path | None = None, structure_only: bool = False) -> dict:
    candidate = candidate.resolve()
    errors, warnings = [], []
    fields = {}
    try:
        files = package_files(candidate)
        fields, body = parse_frontmatter((candidate / "SKILL.md").read_text(encoding="utf-8-sig"))
        if fields["name"] != candidate.name:
            errors.append("skill name must match directory")
        if not body.strip():
            errors.append("empty skill body")
        for path in files:
            if path.suffix == ".py":
                ast.parse(path.read_text(encoding="utf-8-sig"), filename=path.name)
            if path.suffix not in {".md", ".txt"} or "checks" in path.relative_to(candidate).parts:
                continue
            text = path.read_text(encoding="utf-8-sig")
            if re.search(r"\b(?:TODO|TBD|FIXME)\b|待填写", text):
                errors.append(f"unfinished scaffold: {path.relative_to(candidate)}")
            if RISK.search(text):
                errors.append(f"instruction/command signal needs review and removal from active instructions: {path.relative_to(candidate)}")
            for link in re.findall(r"\]\(([^)]+)\)", text):
                link = link.strip().strip("<>")
                scheme = urlsplit(link).scheme
                if scheme and scheme not in {"http", "https", "mailto"}:
                    raise ValueError("unsupported or nonportable link scheme")
                if scheme or link.startswith("#"):
                    continue
                destination = unquote(link.split("#")[0])
                if destination:
                    relative_file(candidate, (path.parent / destination).relative_to(candidate).as_posix())
    except (ValueError, OSError, SyntaxError, KeyError) as error:
        errors.append(str(error))
    structural_pass = not errors
    provenance_pass, acceptance_complete = None, None
    if not structure_only:
        try:
            if work is None:
                raise ValueError("--work is required for provenance validation")
            evidence = read_json(candidate / "evidence.json")
            if not isinstance(evidence, dict):
                raise ValueError("evidence must be a JSON object")
            if evidence.get("schema_version") != 1 or evidence.get("managed_by") != "content-to-skill":
                raise ValueError("invalid evidence schema or owner")
            if evidence.get("mode") not in {"workflow", "tool", "reference"}:
                raise ValueError("invalid skill mode")
            if not isinstance(evidence.get("sources"), list) or not isinstance(evidence.get("claims"), list) or not evidence["sources"] or not evidence["claims"]:
                raise ValueError("sources and claim-to-section mappings are required")
            source_map = {sid: source_record(work, sid) for sid in evidence["sources"]}
            sourced_claims = 0
            for claim in evidence["claims"]:
                if not isinstance(claim, dict):
                    raise ValueError("each claim must be a JSON object")
                if not claim.get("rule", "").strip():
                    raise ValueError("claim rule is empty")
                basis = claim.get("basis")
                if basis in {"adaptation", "inference"}:
                    if not claim.get("reason", "").strip():
                        raise ValueError("adaptation/inference needs a reason")
                    continue
                if basis not in {"source", "official"}:
                    raise ValueError("unknown claim basis")
                directory, rec = source_map[claim["source_id"]]
                sid = claim["section_id"]
                if not SECTION_ID.fullmatch(sid):
                    raise ValueError("invalid section ID")
                section = next((item for item in rec["sections"] if item["id"] == sid), None)
                if not section or sha(relative_file(directory, section["file"]).read_bytes()) != section["sha256"]:
                    raise ValueError("referenced source section is missing or changed")
                sourced_claims += 1
            if not sourced_claims:
                raise ValueError("at least one rule must be mapped to a source section")
            if not isinstance(evidence.get("dependencies", []), list):
                raise ValueError("dependencies must be an array")
            for dependency in evidence.get("dependencies", []):
                if not isinstance(dependency, dict) or dependency.get("status") not in {"available", "missing", "unverified"}:
                    raise ValueError("dependency must have an explicit availability status")
                if dependency.get("status") == "available":
                    relative_file(candidate, dependency.get("evidence", ""))
                elif dependency.get("required", True):
                    raise ValueError("required dependency is missing or unverified: " + dependency.get("name", "unnamed"))
            if evidence.get("blocking_gaps"):
                raise ValueError("critical source gaps remain unresolved")
            warnings.extend(evidence.get("known_gaps", []))
            provenance_pass = True
        except (ValueError, OSError, KeyError, TypeError) as error:
            errors.append("provenance/dependencies: " + str(error))
            provenance_pass = False
        try:
            acceptance = read_json(candidate / "acceptance.json")
            if not isinstance(acceptance, dict):
                raise ValueError("acceptance must be a JSON object")
            if acceptance.get("schema_version") != 1 or not acceptance.get("verified_by", "").strip():
                raise ValueError("invalid acceptance schema or missing verifier")
            if acceptance.get("package_sha256") != fingerprint(candidate):
                raise ValueError("acceptance is stale: package fingerprint changed")
            cases = acceptance.get("cases", [])
            if not isinstance(cases, list) or not all(isinstance(item, dict) for item in cases):
                raise ValueError("acceptance cases must be an array of objects")
            if not {"normal", "transfer"}.issubset({item.get("kind") for item in cases}):
                raise ValueError("normal and transfer cases are required")
            for case in cases:
                if case.get("result") != "pass" or not all(isinstance(case.get(k), str) and case[k].strip() for k in ("input", "expected", "observed")):
                    raise ValueError("failed/incomplete acceptance case")
                relative_file(candidate, case.get("evidence", ""))
            if len({item["input"].strip() for item in cases}) < 2:
                raise ValueError("transfer input must differ from normal input")
            acceptance_complete = True
        except (ValueError, OSError, KeyError, TypeError) as error:
            errors.append("acceptance: " + str(error))
            acceptance_complete = False
    return {"schema_version": 1, "checked_at": now(), "name": fields.get("name"),
            "structural_pass": structural_pass, "provenance_pass": provenance_pass,
            "acceptance_evidence_complete": acceptance_complete, "behavior_verification": "agent_recorded_not_independently_executed_by_validator",
            "installable": not errors and not structure_only, "errors": errors, "warnings": warnings}


def safe_remove(path: Path, parent: Path) -> None:
    resolved = within(path, parent)
    if linked(path):
        raise ValueError("refusing recursive removal of a link")
    if resolved.exists():
        shutil.rmtree(resolved)


def install(candidate: Path, work: Path, root: Path, replace: bool = False) -> dict:
    candidate, work, root = candidate.resolve(), work.resolve(), root.resolve()
    within(candidate, work)
    if work == root or work.is_relative_to(root):
        raise ValueError("work directory must be outside the discoverable skill root")
    report = validate(candidate, work)
    if not report["installable"]:
        raise ValueError("candidate is not installable: " + "; ".join(report["errors"]))
    target = root / candidate.name
    if linked(target):
        raise ValueError("refusing a linked destination")
    backup = None
    if target.exists():
        receipt = target / ".content-to-skill-install.json"
        if not replace or not receipt.is_file() or read_json(receipt).get("managed_by") != "content-to-skill":
            raise ValueError("destination exists; only managed skills can be updated with --replace")
        backup = work / "backups" / candidate.name / (datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8])
        old_hash = fingerprint(target, False)
        backup.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(target, backup)
        if fingerprint(backup, False) != old_hash:
            raise ValueError("backup read-back mismatch; destination was not changed")
    staging_root = root / ".content-to-skill-staging"
    if linked(staging_root):
        raise ValueError("refusing a linked staging directory")
    stage = staging_root / uuid.uuid4().hex
    stage.mkdir(parents=True)
    expected, old_moved, new_moved = fingerprint(candidate), False, False
    committed, cleanup_warning = False, None
    try:
        shutil.copytree(candidate, stage / "new")
        if fingerprint(stage / "new") != expected:
            raise ValueError("staged content read-back mismatch")
        if target.exists():
            target.rename(stage / "old")
            old_moved = True
        (stage / "new").rename(target)
        new_moved = True
        if fingerprint(target) != expected:
            raise ValueError("installed content read-back mismatch")
        receipt = {"schema_version": 1, "managed_by": "content-to-skill", "installed_at": now(),
                   "package_sha256": expected, "backup": str(backup) if backup else None}
        write_json(target / ".content-to-skill-install.json", receipt)
        committed = True
    except Exception:
        if new_moved:
            safe_remove(target, root)
        if old_moved:
            (stage / "old").rename(target)
        raise
    finally:
        # Every recursive removal is limited to this invocation's verified absolute stage path.
        if committed or not (stage / "old").exists():
            try:
                safe_remove(stage, staging_root)
            except OSError:
                if not committed:
                    raise
                cleanup_warning = "installed and verified; temporary backup cleanup was incomplete: " + str(stage)
    return {"installed": str(target), "sha256": expected, "backup": str(backup) if backup else None,
            "runtime_reload": "not_verified", "cleanup_warning": cleanup_warning}


def parser() -> argparse.ArgumentParser:
    cli = argparse.ArgumentParser(description=__doc__)
    sub = cli.add_subparsers(dest="command", required=True)
    ingest_p = sub.add_parser("ingest")
    ingest_p.add_argument("inputs", nargs="+")
    ingest_p.add_argument("--work", required=True)
    for flag in ("origin", "title", "author", "published", "encoding"):
        ingest_p.add_argument("--" + flag)
    ingest_p.add_argument("--refresh", action="store_true")
    catalog_p = sub.add_parser("catalog")
    catalog_p.add_argument("--work", required=True)
    find_p = sub.add_parser("find")
    find_p.add_argument("--root", default=str(DEFAULT_ROOT))
    find_p.add_argument("--query", required=True)
    draft_p = sub.add_parser("draft")
    draft_p.add_argument("--work", required=True)
    draft_p.add_argument("--name", required=True)
    draft_p.add_argument("--mode", choices=("workflow", "tool", "reference"), required=True)
    draft_p.add_argument("--description", required=True)
    draft_p.add_argument("--source", action="append", required=True)
    for cmd in ("validate", "install", "fingerprint"):
        item = sub.add_parser(cmd)
        item.add_argument("candidate", type=Path)
        if cmd != "fingerprint":
            item.add_argument("--work", type=Path, required=cmd == "install")
        if cmd == "validate":
            item.add_argument("--structure-only", action="store_true")
            item.add_argument("--report", type=Path)
        if cmd == "install":
            item.add_argument("--root", type=Path, default=DEFAULT_ROOT)
            item.add_argument("--replace", action="store_true")
    return cli


def main() -> int:
    args = parser().parse_args()
    try:
        code = 0
        if args.command == "ingest":
            output, code = ingest(args)
        elif args.command == "catalog":
            output = catalog(Path(args.work).resolve())
        elif args.command == "find":
            output = find_skills(Path(args.root), args.query)
        elif args.command == "draft":
            output = draft(args)
        elif args.command == "fingerprint":
            output = {"package_sha256": fingerprint(args.candidate)}
        elif args.command == "validate":
            output = validate(args.candidate, args.work, args.structure_only)
            code = int(bool(output["errors"]))
            if args.report:
                write_json(args.report, output)
        else:
            output = install(args.candidate, args.work, args.root, args.replace)
        print(json.dumps(output, ensure_ascii=False, indent=2))
        return code
    except (ValueError, OSError, KeyError, TypeError, SyntaxError, AttributeError) as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    for stream in (sys.stdin, sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    raise SystemExit(main())
