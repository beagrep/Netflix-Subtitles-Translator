#!/usr/bin/env python3
"""
Netflix Subtitles Translator - local AI optimization server.

Listens on 127.0.0.1 (default port 31314) and accepts bilingual subtitle
org-mode text plus optional source/target TTML files, spawns Claude Code
(https://claude.com/code) as a subprocess to optimize/revise them, and
returns the revised org text.

Protocol:
    GET  /api/health                -> {"ok": true, "version": "1.0"}
    POST /api/optimize              -> multipart form: org, src_ttml?, tgt_ttml?,
                                       title?, src_lang?, tgt_lang?, url?, style_guide?
                                       returns {"job_id": "<id>"}
    GET  /api/status/<job_id>       -> {"status": "queued"|"running"|"done"|"error",
                                       "progress": "...", "result": "<org text>",
                                       "error": "..."}

Start:
    python3 nst_server.py [--port 31314]
    or ./run.sh

The server binds ONLY to 127.0.0.1; no external network access.  Jobs write
their input files into a temp directory and invoke `claude -p <prompt>` with
--add-dir pointing at that directory.  Requires claude CLI to be installed
and authenticated (run `claude` once in a terminal to auth).
"""

from __future__ import annotations

import argparse
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*cgi.*")

import cgi
import json
import os
import random
import re
import shutil
import string
import subprocess
import sys
import tempfile
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

VERSION = "1.0"
DEFAULT_PORT = int(os.environ.get("NST_PORT", "31314"))

CLAUDE_BIN = os.environ.get("NST_CLAUDE_BIN", "claude")
JOB_TTL_SECONDS = 3600  # clean up jobs older than an hour

# In-memory job registry: job_id -> {status, progress, result, error, dir, ts}
jobs = {}
jobs_lock = threading.Lock()


PROMPT_TEMPLATE = """You are revising a bilingual Netflix subtitle file in org-mode format.

Context:
- Title: {title}
- URL: {url}
- Source language: {src_lang}
- Target language: {tgt_lang}
- The translations in this file are OFFICIAL NETFLIX TRANSLATIONS (not Google machine translation). Human translators already translated them. Character names, place names, and terminology are intentionally chosen by Netflix and should generally be PRESERVED — do NOT second-guess names you don't recognize or rename them to your own preferred transliteration.
- The source subtitle (in the source language, often Korean/Japanese) may contain CC / closed-caption information: speaker labels in brackets like `[수근]`, sound effects like `(웃음)`, music markers `♪`, off-screen narration markers, descriptions of on-screen text. The target subtitle sometimes omits these CC markers.
- Some entries are tagged :SRC_ONLY: meaning the source subtitle exists but Netflix provides no target translation (common when the director intentionally leaves lines untranslated, or for songs).  For these entries, the body is currently the placeholder `（无目标字幕）`. Please provide an accurate translation of the source into {tgt_lang} and replace the placeholder. Keep the heading (source text), timestamp, and tags unchanged.
- Some entries are tagged :TGT_ONLY: meaning there is a target subtitle but no source subtitle. This happens for ON-SCREEN TEXT (letters, signs, documents) in K-dramas: Netflix skips captioning the source language because the viewer is already reading it visually, but it still provides a translation. For these entries, replace the placeholder `（无源字幕）` with a brief note like `[on-screen text]` (or the equivalent appropriate note in the target language), or a short transcription of the on-screen text if you can infer it from context.
- {style_guide_note}

Files you can read in the current directory:
- bilingual.org -- the bilingual org file you must revise.
- source.ttml -- the raw source-language TTML (optional, may be missing).
- target.ttml -- the raw target-language TTML (optional, may be missing).

Your tasks, in order of priority:
1. Fill in any missing CC information. If a source subtitle has a speaker label, sound effect, music marker, or narration label that is missing from the target translation, add it (preserving the target language, e.g. in Chinese `(笑)`, `[music]`).
2. For :SRC_ONLY: entries, translate the source into {tgt_lang} naturally. Replace `（无目标字幕）` with the translation.
3. For :TGT_ONLY: entries, replace `（无源字幕）` with a short note indicating the cue is for on-screen text (e.g. `[on-screen text]` for English, `[画面文字]` for Chinese, etc.).  If the target text itself has a clear typo or obvious Netflix timing artifact, you may fix it conservatively — do NOT rewrite good target text.
4. Keep every existing translation that is already complete and correct. Do NOT retranslate lines that already have a natural translation. Do NOT rename characters. Do NOT change the timestamps. Do NOT reorder entries. Do NOT drop entries. Do NOT merge or split entries.
5. Preserve ALL org-mode structure verbatim: every `* ` heading, every `[M:SS]` or `[H:MM:SS]` timestamp, every tag (`:OFFICIAL:`, `:SRC_ONLY:`, `:TGT_ONLY:`), every `#+TITLE:`, `#+DATE:`, `#+URL:`, `#+SOURCE_LANG:`, `#+TARGET_LANG:`, `#+SUBTITLE_COUNT:`, `#+OFFICIAL_SUBTITLES:` header line. Do not add new header lines, do not remove any.
6. If possible, split the bilingual.org into 10-minute parts and use parallel sub-agents to do the translation, then re-combine it.

Output format:
- Output the FULL revised org file content, starting with `#+TITLE:` (without the space between # and +) at line 1 and ending with the last entry body.
- Do NOT wrap the output in markdown fences (no ```org or ```).
- Do NOT add a preamble, explanation, apology, or postamble.  Output the org text and nothing else.
- Do NOT say "Here is the revised file" or similar.
"""


def new_job_id():
    alphabet = string.ascii_lowercase + string.digits
    return "".join(random.choice(alphabet) for _ in range(12))


def clean_old_jobs():
    now = time.time()
    with jobs_lock:
        for jid in list(jobs.keys()):
            job = jobs[jid]
            if now - job.get("ts", now) > JOB_TTL_SECONDS and job["status"] in ("done", "error"):
                shutil.rmtree(job["dir"], ignore_errors=True)
                del jobs[jid]


def strip_markdown_fences(text: str) -> str:
    # Claude sometimes wraps the output in ```org ... ```; strip that if present.
    if not text:
        return text
    stripped = text.strip()
    m = re.match(r"^```(?:org|markdown)?\s*\n?(.*?)\n?```\s*$", stripped, re.DOTALL)
    if m:
        return m.group(1)
    return text


def run_job(job_id, job_dir, org_text, src_ttml, tgt_ttml, meta):
    with jobs_lock:
        jobs[job_id]["status"] = "running"
        jobs[job_id]["progress"] = "writing input files"

    try:
        with open(os.path.join(job_dir, "bilingual.org"), "w", encoding="utf-8") as f:
            f.write(org_text)
        if src_ttml:
            with open(os.path.join(job_dir, "source.ttml"), "w", encoding="utf-8") as f:
                f.write(src_ttml)
        if tgt_ttml:
            with open(os.path.join(job_dir, "target.ttml"), "w", encoding="utf-8") as f:
                f.write(tgt_ttml)

        style_guide = (meta.get("style_guide") or "").strip()
        style_guide_note = (
            "Additional style guide notes supplied by the user:\n" + style_guide
            if style_guide
            else "No additional style guide provided."
        )

        prompt = PROMPT_TEMPLATE.format(
            title=meta.get("title") or "(unknown)",
            url=meta.get("url") or "(unknown)",
            src_lang=meta.get("src_lang") or "source",
            tgt_lang=meta.get("tgt_lang") or "target",
            style_guide_note=style_guide_note,
        )

        with open(os.path.join(job_dir, "prompt.md"), "w", encoding="utf-8") as f:
            f.write(prompt)

        with jobs_lock:
            jobs[job_id]["progress"] = "starting claude..."

        # Invoke claude -p from within the job dir.  We use --dangerously-skip-permissions
        # so the non-interactive subprocess does not hang waiting for permission prompts;
        # the cwd and --add-dir are scoped to the per-job temp directory so claude cannot
        # modify anything outside that tree.
        cmd = [
            CLAUDE_BIN,
            "-p",
            prompt,
            "--bare",
            "--dangerously-skip-permissions",
            "--add-dir",
            job_dir,
        ]

        # Capture stdout/stderr incrementally to show progress
        stdout_parts = []
        stderr_parts = []
        last_update = time.time()

        with subprocess.Popen(
            cmd,
            cwd=job_dir,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=0
        ) as proc:
            # Use threads to read both streams without blocking
            def read_stream(stream, parts_list, is_stderr):
                nonlocal last_update
                while True:
                    chunk = stream.read(1024)
                    if not chunk:
                        break
                    text = chunk.decode("utf-8", errors="replace")
                    parts_list.append(text)
                    # Update progress periodically or when we get meaningful output
                    now = time.time()
                    if now - last_update > 0.5:
                        last_update = now
                        # Try to extract a meaningful progress message
                        combined = ''.join(parts_list[-5:]) if is_stderr else ''.join(parts_list)
                        lines = [l.strip() for l in combined.splitlines() if l.strip()]
                        with jobs_lock:
                            if job_id in jobs and jobs[job_id]["status"] == "running":
                                if lines:
                                    progress_msg = lines[-1][:100]
                                    jobs[job_id]["progress"] = "claude: " + progress_msg
                                elif is_stderr:
                                    jobs[job_id]["progress"] = "claude is working..."

            stdout_thread = threading.Thread(target=read_stream, args=(proc.stdout, stdout_parts, False))
            stderr_thread = threading.Thread(target=read_stream, args=(proc.stderr, stderr_parts, True))
            stdout_thread.start()
            stderr_thread.start()

            # Wait for process to complete with timeout
            start_time = time.time()
            while True:
                if proc.poll() is not None:
                    break
                if time.time() - start_time > 600:  # 10 minutes
                    proc.kill()
                    raise subprocess.TimeoutExpired(cmd, 600)
                time.sleep(0.1)

            stdout_thread.join()
            stderr_thread.join()
            returncode = proc.returncode

        stdout = ''.join(stdout_parts)
        stderr = ''.join(stderr_parts)

        # Save raw output for debugging.
        with open(os.path.join(job_dir, "claude.stdout"), "w", encoding="utf-8") as f:
            f.write(stdout)
        if stderr:
            with open(os.path.join(job_dir, "claude.stderr"), "w", encoding="utf-8") as f:
                f.write(stderr)

        if returncode != 0:
            # Don't fail hard; claude sometimes exits non-zero but still emits output.
            # Log a warning and continue with whatever output we have.
            sys.stderr.write("[nst-server] warning: claude exited %d\n" % returncode)
            if stderr:
                sys.stderr.write("[nst-server] stderr: %s\n" % stderr[-1000:])

        revised = strip_markdown_fences(stdout)

        # Relaxed sanity check: if output is empty, use original input;
        # otherwise just use whatever we get, even if it seems incomplete.
        if not revised or revised.strip() == "":
            # Fall back to original input if Claude gave us nothing
            revised = org_text
            sys.stderr.write("[nst-server] warning: Claude returned empty output, using original input\n")

        with jobs_lock:
            jobs[job_id]["status"] = "done"
            jobs[job_id]["progress"] = "done"
            jobs[job_id]["result"] = revised

        # Write revised.org for inspection
        with open(os.path.join(job_dir, "revised.org"), "w", encoding="utf-8") as f:
            f.write(revised)

    except subprocess.TimeoutExpired:
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = "Claude timed out after 10 minutes."
    except Exception as exc:
        traceback.print_exc()
        with jobs_lock:
            jobs[job_id]["status"] = "error"
            jobs[job_id]["error"] = str(exc)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # quieter logging
        sys.stderr.write("[nst-server] %s - %s\n" % (self.address_string(), fmt % args))

    def _send_json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        clean_old_jobs()
        path = self.path.split("?", 1)[0]
        if path == "/api/health":
            self._send_json(200, {"ok": True, "version": VERSION})
            return
        m = re.match(r"^/api/status/([A-Za-z0-9_-]+)$", path)
        if m:
            jid = m.group(1)
            with jobs_lock:
                job = jobs.get(jid)
            if not job:
                self._send_json(404, {"ok": False, "error": "not found"})
                return
            resp = {"status": job["status"], "progress": job.get("progress", "")}
            if job["status"] == "done":
                resp["result"] = job["result"]
            if job["status"] == "error":
                resp["error"] = job.get("error", "unknown error")
            self._send_json(200, resp)
            return
        self._send_json(404, {"ok": False, "error": "not found"})

    def do_POST(self):
        clean_old_jobs()
        if self.path != "/api/optimize":
            self._send_json(404, {"ok": False, "error": "not found"})
            return

        try:
            ctype = self.headers.get("Content-Type", "")
            # Parse multipart form data via stdlib cgi.FieldStorage.  to parse multipart.  This is a bit fiddly because
            # FieldStorage wants a file-like object and a content-type with boundary.
            form = cgi.FieldStorage(
                fp=self.rfile,
                headers=self.headers,
                environ={
                    "REQUEST_METHOD": "POST",
                    "CONTENT_TYPE": ctype,
                    "CONTENT_LENGTH": self.headers.get("Content-Length"),
                },
                keep_blank_values=True,
            )

            def get_field(name, required=False, as_file=False):
                if name not in form:
                    if required:
                        raise ValueError("missing field: " + name)
                    return None
                item = form[name]
                if item.filename is not None or as_file:
                    return item.file.read().decode("utf-8", errors="replace") if item.file else ""
                return item.value or ""

            org_text = get_field("org", required=True)
            src_ttml = get_field("src_ttml")
            tgt_ttml = get_field("tgt_ttml")
            meta = {
                "title": get_field("title") or "",
                "url": get_field("url") or "",
                "src_lang": get_field("src_lang") or "",
                "tgt_lang": get_field("tgt_lang") or "",
                "style_guide": get_field("style_guide") or "",
            }
        except Exception as exc:
            self._send_json(400, {"ok": False, "error": "bad request: " + str(exc)})
            return

        job_id = new_job_id()
        job_dir = tempfile.mkdtemp(prefix="nst-job-" + job_id + "-")
        with jobs_lock:
            jobs[job_id] = {
                "status": "queued",
                "progress": "queued",
                "result": None,
                "error": None,
                "dir": job_dir,
                "ts": time.time(),
            }

        t = threading.Thread(
            target=run_job,
            args=(job_id, job_dir, org_text, src_ttml, tgt_ttml, meta),
            daemon=True,
        )
        t.start()

        self._send_json(202, {"ok": True, "job_id": job_id})


def main():
    parser = argparse.ArgumentParser(description="NST local AI optimization server")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    sys.stderr.write(
        "[nst-server] listening on http://%s:%s (version %s)\n" % (args.host, args.port, VERSION)
    )
    sys.stderr.write("[nst-server] claude binary: %s\n" % CLAUDE_BIN)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        sys.stderr.write("[nst-server] shutting down\n")
        server.server_close()


if __name__ == "__main__":
    main()
