#!/usr/bin/env python3
"""Render checked-in course Markdown to self-contained HTML (images stay relative).
Optional authoring dependency: python -m pip install markdown-it-py
No Python dependency is required to read the prebuilt HTML or run the course.
"""
from pathlib import Path
import re
from markdown_it import MarkdownIt

root = Path(__file__).resolve().parents[1] / 'docs' / 'training'
md = MarkdownIt('commonmark', {'html': False}).enable('table')
css = '''body{margin:0;background:#f5f6f8;color:#192c3e;font:17px/1.8 system-ui,sans-serif}main{max-width:1040px;margin:auto;padding:32px 28px 80px;background:white}h1{font-size:30px}h2{margin-top:52px;padding-bottom:8px;border-bottom:2px solid #cddce5}a{color:#075985}img{display:block;max-width:100%;height:auto;border:1px solid #cddce5;margin:24px auto}pre{padding:20px;background:#102e47;color:#f0f8ff;overflow:auto;border-radius:8px}code{font-family:ui-monospace,monospace;font-size:.9em}table{border-collapse:collapse;width:100%;display:block;overflow:auto}th,td{border:1px solid #ccd7e0;padding:10px 14px;text-align:left}th{background:#edf3f8}strong{color:#133c57}@media print{main{max-width:none;padding:0}h2{break-after:avoid}img,tr,pre{break-inside:avoid}a{color:inherit}}'''
for source in sorted(root.glob('*.md')):
    text = source.read_text()
    # Convert course-internal Markdown links; leave external and source links intact.
    text = re.sub(r'\]\(([^)\s]+)\.md(#[^)]*)?\)', lambda m: f']({m[1]}.html{m[2] or ""})', text)
    lang = 'ja' if '.ja.' in source.name else 'en'
    title = source.read_text().splitlines()[0].lstrip('# ')
    import html
    output = f'<!doctype html><html lang="{lang}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title><style>{css}</style><main>{md.render(text)}</main></html>\n'
    source.with_suffix('.html').write_text(output)
    print(source.with_suffix('.html').relative_to(root.parent.parent))
