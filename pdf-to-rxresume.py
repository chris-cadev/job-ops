#!/usr/bin/env python3
"""
pdf-to-rxresume.py — Convert a PDF resume to Reactive Resume v5 JSON via LLM.

Usage:
  python pdf-to-rxresume.py path/to/resume.pdf [--output out.json] [--llm-url URL] [--llm-model MODEL]

Requires: PyMuPDF (fitz). LM Studio instance with OpenAI-compatible endpoint.
"""

import argparse
import json
import os
import sys
import urllib.request
import urllib.error
import uuid

try:
    import fitz
except ImportError:
    print("Error: PyMuPDF is required. Install it with: pip install PyMuPDF", file=sys.stderr)
    sys.exit(1)


DEFAULT_LLM_URL = "http://172.30.192.1:1234"
DEFAULT_LLM_MODEL = "google/gemma-4-e4b"

SYSTEM_PROMPT = """You are a resume parser. Convert the provided resume text into valid Reactive Resume v5 JSON.

RULES:
- Output ONLY valid JSON. No markdown fences, no commentary, no extra text.
- Every id field must be a UUID v4 string. Generate fresh UUIDs.
- Include ALL 12 section keys in "sections": profiles, experience, education, projects, skills, languages, interests, awards, certifications, publications, volunteer, references. Set hidden: true with empty items[] for sections without data.
- Description/summary fields may contain simple HTML (<p>, <ul>, <li>, <code>).
- Use en dashes (\\u2013) for date ranges like "Jan 2020 \\u2013 Dec 2023".
- NEVER include a trailing comma.

EXACT SCHEMA (top-level):
{
  "$schema": "https://rxresu.me/schema.json",
  "version": "5.0.0",
  "picture": { "hidden": true, "url": "", "size": 80, "rotation": 0, "aspectRatio": 1, "borderRadius": 0, "borderColor": "rgba(0,0,0,0.5)", "borderWidth": 0, "shadowColor": "rgba(0,0,0,0.5)", "shadowWidth": 0 },
  "basics": { "name": "", "headline": "", "email": "", "phone": "", "location": "", "website": { "url": "", "label": "", "inlineLink": false }, "customFields": [] },
  "summary": { "title": "Summary", "columns": 1, "hidden": false, "content": "" },
  "sections": { ... },
  "customSections": [],
  "metadata": {
    "template": "onyx",
    "layout": { "sidebarWidth": 35, "pages": [{ "fullWidth": false, "main": ["profiles","summary","experience","education"], "sidebar": ["skills"] }] },
    "page": { "gapX": 8, "gapY": 8, "marginX": 16, "marginY": 16, "format": "a4", "locale": "en-US", "hideLinkUnderline": false, "hideIcons": false, "hideSectionIcons": false },
    "design": { "level": { "icon": "star", "type": "icon" }, "colors": { "primary": "rgba(0,0,0,1)", "text": "rgba(0,0,0,1)", "background": "rgba(255,255,255,1)" } },
    "typography": { "body": { "fontFamily": "Inter", "fontWeights": ["400","500","600"], "fontSize": 10, "lineHeight": 1.5 }, "heading": { "fontFamily": "Inter", "fontWeights": ["600","700"], "fontSize": 14, "lineHeight": 1.3 } },
    "notes": "",
    "styleRules": []
  }
}

EXPERIENCE ITEM SHAPE:
{
  "id": "uuid", "hidden": false,
  "company": "", "position": "", "location": "", "period": "",
  "website": { "url": "", "label": "", "inlineLink": false },
  "description": "",
  "roles": [{ "id": "uuid", "position": "", "period": "", "description": "" }]
}
Use the "roles" array for sub-roles/projects within a company.

SKILLS ITEM SHAPE:
{
  "id": "uuid", "hidden": false, "icon": "", "iconColor": "",
  "name": "", "proficiency": "", "level": 0,
  "keywords": [""]
}

EDUCATION ITEM SHAPE:
{
  "id": "uuid", "hidden": false,
  "school": "", "degree": "", "area": "", "grade": "", "location": "",
  "period": "",
  "website": { "url": "", "label": "", "inlineLink": false },
  "description": ""
}

PROFILES ITEM SHAPE:
{
  "id": "uuid", "hidden": false, "icon": "", "iconColor": "",
  "network": "", "username": "",
  "website": { "url": "", "label": "", "inlineLink": false }
}
"""


def extract_text_from_pdf(pdf_path: str) -> str:
    doc = fitz.open(pdf_path)
    pages = []
    for page in doc:
        pages.append(page.get_text())
    doc.close()
    return "\n".join(pages)


def call_llm(text: str, llm_url: str, llm_model: str) -> str:
    url = f"{llm_url.rstrip('/')}/v1/chat/completions"
    payload = json.dumps({
        "model": llm_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Convert this resume to Reactive Resume v5 JSON:\n\n{text}"}
        ],
        "temperature": 0.1,
        "max_tokens": 8192
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        print(f"LLM API error {e.code}: {body}", file=sys.stderr)
        sys.exit(1)
    except urllib.error.URLError as e:
        print(f"Connection failed: {e.reason}", file=sys.stderr)
        sys.exit(1)

    try:
        content = result["choices"][0]["message"]["content"]
    except (KeyError, IndexError) as e:
        print(f"Unexpected LLM response format: {json.dumps(result, indent=2)}", file=sys.stderr)
        sys.exit(1)

    # Strip markdown fences if present
    content = content.strip()
    if content.startswith("```"):
        lines = content.splitlines()
        # Remove first and last fence lines
        content = "\n".join(lines[1:-1]).strip()

    return content


def validate_resume_json(obj: dict) -> list[str]:
    errors = []

    # Required top-level keys
    for key in ("$schema", "version", "picture", "basics", "summary", "sections", "customSections", "metadata"):
        if key not in obj:
            errors.append(f"Missing top-level key: {key}")

    if "sections" in obj:
        required_sections = [
            "profiles", "experience", "education", "projects", "skills",
            "languages", "interests", "awards", "certifications",
            "publications", "volunteer", "references"
        ]
        for s in required_sections:
            if s not in obj["sections"]:
                errors.append(f"Missing section: {s}")

    # Metadata required sub-keys
    meta = obj.get("metadata", {})
    for key in ("template", "layout", "page", "design", "typography", "notes", "styleRules"):
        if key not in meta:
            errors.append(f"Missing metadata key: {key}")

    page = meta.get("page", {})
    for key in ("gapX", "gapY", "marginX", "marginY", "format", "locale", "hideLinkUnderline", "hideIcons", "hideSectionIcons"):
        if key not in page:
            errors.append(f"Missing metadata.page key: {key}")

    design = meta.get("design", {})
    level = design.get("level", {})
    for key in ("icon", "type"):
        if key not in level:
            errors.append(f"Missing metadata.design.level key: {key}")

    return errors


def main():
    parser = argparse.ArgumentParser(description="Convert a PDF resume to Reactive Resume v5 JSON")
    parser.add_argument("pdf", help="Path to the PDF resume")
    parser.add_argument("--output", "-o", default=None, help="Output JSON path (default: <pdf-name>-rxresume.json)")
    parser.add_argument("--llm-url", default=DEFAULT_LLM_URL, help=f"LM Studio API base URL (default: {DEFAULT_LLM_URL})")
    parser.add_argument("--llm-model", default=DEFAULT_LLM_MODEL, help=f"Model name (default: {DEFAULT_LLM_MODEL})")
    args = parser.parse_args()

    if not os.path.isfile(args.pdf):
        print(f"Error: File not found: {args.pdf}", file=sys.stderr)
        sys.exit(1)

    # Determine output path
    if args.output:
        out_path = args.output
    else:
        base = os.path.splitext(os.path.basename(args.pdf))[0]
        out_path = f"{base}-rxresume.json"

    print(f"[1/3] Extracting text from: {args.pdf}")
    text = extract_text_from_pdf(args.pdf)
    print(f"       extracted {len(text)} characters")

    print(f"[2/3] Sending to LLM ({args.llm_model})...")
    raw = call_llm(text, args.llm_url, args.llm_model)
    print(f"       received {len(raw)} characters")

    # Parse JSON
    try:
        resume = json.loads(raw)
    except json.JSONDecodeError as e:
        print(f"Error: LLM returned invalid JSON: {e}", file=sys.stderr)
        print("Raw response snippet:", raw[:1000], file=sys.stderr)
        sys.exit(1)

    print("[3/3] Validating...")
    errors = validate_resume_json(resume)
    if errors:
        print("Warning: validation issues found:", file=sys.stderr)
        for err in errors:
            print(f"  - {err}", file=sys.stderr)

    # Add fresh UUIDs for all items (the LLM might repeat the same ones)
    def assign_uuids(obj):
        if isinstance(obj, dict):
            if "id" in obj and isinstance(obj["id"], str):
                obj["id"] = str(uuid.uuid4())
            for v in obj.values():
                assign_uuids(v)
        elif isinstance(obj, list):
            for item in obj:
                assign_uuids(item)

    assign_uuids(resume)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(resume, f, indent=2, ensure_ascii=False)

    print(f"\nDone — saved to: {out_path}")


if __name__ == "__main__":
    main()
