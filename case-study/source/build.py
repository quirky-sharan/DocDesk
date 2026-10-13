# -*- coding: utf-8 -*-
"""
Builds the case study PDF from the plain-text files in ./content.

    python build.py

Output: ../OpenMRS_RBAC_Data_Security_Case_Study.pdf

To change the cover page, edit the COVER dictionary below and run the script again.
The text of the report lives in content/*.txt, the reference list in references.py
and the diagrams in figures.py.
"""
import glob
import os
import re
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, CondPageBreak, Frame, KeepTogether,
                                NextPageTemplate, PageBreak, PageTemplate, Paragraph,
                                Preformatted, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), 'OpenMRS_RBAC_Data_Security_Case_Study.pdf')

# --------------------------------------------------------------------------------------
# Cover page details. Leave a value empty to omit it from the cover.
# --------------------------------------------------------------------------------------
COVER = {
    'title': 'Role-Based Access Control and Data Security in Open-Source Healthcare Systems',
    'subtitle': 'A Case Study of OpenMRS',
    'kind': 'Case Study Report',
    'course': 'Database Management Systems',
    'authors': [],        # e.g. [('Full Name', 'Roll No.'), ('Full Name', 'Roll No.')]
    'guide': '',          # e.g. 'Prof. Full Name'
    'department': '',     # e.g. 'Department of Computer Science and Engineering'
    'institution': '',    # e.g. 'Name of the Institute, City'
    'date': 'October 2026',
}

# --------------------------------------------------------------------------------------
# Fonts: Times New Roman for text, Courier New for code
# --------------------------------------------------------------------------------------
FONT_DIR = os.path.join(os.environ.get('WINDIR', r'C:\Windows'), 'Fonts')


def _reg(name, filename):
    pdfmetrics.registerFont(TTFont(name, os.path.join(FONT_DIR, filename)))


_reg('TNR', 'times.ttf')
_reg('TNR-Bold', 'timesbd.ttf')
_reg('TNR-Italic', 'timesi.ttf')
_reg('TNR-BoldItalic', 'timesbi.ttf')
pdfmetrics.registerFontFamily('TNR', normal='TNR', bold='TNR-Bold', italic='TNR-Italic',
                              boldItalic='TNR-BoldItalic')
_reg('CourierNew', 'cour.ttf')
_reg('CourierNew-Bold', 'courbd.ttf')
pdfmetrics.registerFontFamily('CourierNew', normal='CourierNew', bold='CourierNew-Bold',
                              italic='CourierNew', boldItalic='CourierNew-Bold')

import figures      # noqa: E402  (needs the fonts registered above)
import references   # noqa: E402

# --------------------------------------------------------------------------------------
# Page geometry and styles
# --------------------------------------------------------------------------------------
PAGE_W, PAGE_H = A4
MARGIN = 72.0                       # one inch on every side
TEXT_W = PAGE_W - 2 * MARGIN
TEXT_H = PAGE_H - 2 * MARGIN
BODY_SIZE = 12
BODY_LEAD = 18                      # 1.5 line spacing
BLACK = colors.black

S = {}
S['body'] = ParagraphStyle('body', fontName='TNR', fontSize=BODY_SIZE, leading=BODY_LEAD,
                           alignment=TA_JUSTIFY, spaceAfter=8, allowWidows=0, allowOrphans=0)
S['bullet'] = ParagraphStyle('bullet', parent=S['body'], leftIndent=22, bulletIndent=8,
                             spaceAfter=3, bulletFontName='TNR', bulletFontSize=BODY_SIZE)
S['chaplabel'] = ParagraphStyle('chaplabel', fontName='TNR-Bold', fontSize=14, leading=18,
                                alignment=TA_LEFT, spaceAfter=4, keepWithNext=1)
S['chaptitle'] = ParagraphStyle('chaptitle', fontName='TNR-Bold', fontSize=19, leading=24,
                                alignment=TA_LEFT, spaceAfter=18, keepWithNext=1)
S['h2'] = ParagraphStyle('h2', fontName='TNR-Bold', fontSize=13.5, leading=18,
                         alignment=TA_LEFT, spaceBefore=12, spaceAfter=6, keepWithNext=1)
S['h3'] = ParagraphStyle('h3', fontName='TNR-BoldItalic', fontSize=12, leading=17,
                         alignment=TA_LEFT, spaceBefore=6, spaceAfter=4, keepWithNext=1)
S['caption'] = ParagraphStyle('caption', fontName='TNR', fontSize=11, leading=14.5,
                              alignment=TA_CENTER, spaceBefore=4, spaceAfter=6)
S['note'] = ParagraphStyle('note', fontName='TNR-Italic', fontSize=10, leading=12.5,
                           alignment=TA_LEFT, spaceBefore=3, spaceAfter=0)
S['code'] = ParagraphStyle('code', fontName='CourierNew', fontSize=8.6, leading=10.8,
                           alignment=TA_LEFT)
S['ref'] = ParagraphStyle('ref', fontName='TNR', fontSize=11, leading=14.5, alignment=TA_LEFT,
                          leftIndent=30, bulletIndent=0, spaceAfter=5, bulletFontName='TNR',
                          bulletFontSize=11)
S['toc0'] = ParagraphStyle('toc0', fontName='TNR-Bold', fontSize=12, leading=17, spaceBefore=5)
S['toc1'] = ParagraphStyle('toc1', fontName='TNR', fontSize=12, leading=16, leftIndent=20)
S['lof'] = ParagraphStyle('lof', fontName='TNR', fontSize=11.5, leading=16, leftIndent=0,
                          spaceBefore=1)


def cover_style(size, lead=None, bold=False, italic=False, after=0):
    font = 'TNR-BoldItalic' if (bold and italic) else 'TNR-Bold' if bold else \
        'TNR-Italic' if italic else 'TNR'
    return ParagraphStyle('cover%s%s%s' % (size, bold, italic), fontName=font, fontSize=size,
                          leading=lead or size * 1.3, alignment=TA_CENTER, spaceAfter=after)


# --------------------------------------------------------------------------------------
# Inline text formatting
# --------------------------------------------------------------------------------------
CITE_ORDER = []          # reference keys in order of first citation
LABELS = {}              # block id -> printed label such as "Table 5.1"
CITE_RE = re.compile(r'\[@([^\]]+)\]')
XREF_RE = re.compile(r'\{@([\w:.\-]+)\}')


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def smart(s):
    """Typographic quotes and en dashes for running text."""
    s = s.replace('--', '\u2013')
    out = []
    for i, ch in enumerate(s):
        if ch == '"':
            prev = s[i - 1] if i else ' '
            out.append('\u201c' if (prev.isspace() or prev in '([{\u2013/') else '\u201d')
        elif ch == "'":
            out.append('\u2019')
        else:
            out.append(ch)
    return ''.join(out)


def _cite_numbers(keys):
    nums = []
    for k in keys:
        if k not in references.REFS:
            raise KeyError('Unknown reference key: %s' % k)
        if k not in CITE_ORDER:
            CITE_ORDER.append(k)
        nums.append(CITE_ORDER.index(k) + 1)
    return nums


def _cite_repl(m):
    keys = [k.strip().lstrip('@') for k in m.group(1).split(';')]
    nums = sorted(set(_cite_numbers(keys)))
    parts, i = [], 0
    while i < len(nums):
        j = i
        while j + 1 < len(nums) and nums[j + 1] == nums[j] + 1:
            j += 1
        if j - i >= 2:
            parts.append('[%d]\u2013[%d]' % (nums[i], nums[j]))
        else:
            parts.extend('[%d]' % n for n in nums[i:j + 1])
        i = j + 1
    return ', '.join(parts)


def _xref_repl(m):
    key = m.group(1)
    if key not in LABELS:
        raise KeyError('Unknown cross-reference: %s' % key)
    return LABELS[key].replace(' ', '\u00a0')


def fmt(text, size=BODY_SIZE):
    """Convert the light markup used in content/*.txt into ReportLab paragraph markup."""
    out = []
    for part in re.split(r'(`[^`]*`)', text):
        if len(part) >= 2 and part.startswith('`') and part.endswith('`'):
            out.append('<font face="CourierNew" size="%.1f">%s</font>'
                       % (size * 0.87, esc(part[1:-1])))
        else:
            t = smart(esc(part))
            t = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', t)
            t = re.sub(r'(?<![\w*])\*(?=\S)(.+?)(?<=\S)\*(?![\w*])', r'<i>\1</i>', t)
            t = CITE_RE.sub(_cite_repl, t)
            t = XREF_RE.sub(_xref_repl, t)
            out.append(t)
    return ''.join(out)


def plain(text):
    """Text for PDF bookmarks: markup removed."""
    t = re.sub(r'`([^`]*)`', r'\1', text)
    t = re.sub(r'\*\*(.+?)\*\*', r'\1', t)
    t = re.sub(r'\*(.+?)\*', r'\1', t)
    t = CITE_RE.sub('', t)
    return smart(t).strip()


# --------------------------------------------------------------------------------------
# Parsing the content files into blocks
# --------------------------------------------------------------------------------------
HEAD_RE = re.compile(r'^(#!|#A|###|##|#)\s+(.*?)(?:\s*\{#([\w:.\-]+)\})?\s*$')
ITEM_RE = re.compile(r'^(-|\d+\.)\s+(.*)$')


def read_lines():
    lines = []
    for path in sorted(glob.glob(os.path.join(HERE, 'content', '*.txt'))):
        with open(path, encoding='utf-8') as fh:
            lines.extend(fh.read().splitlines())
        lines.append('')
    return lines


def parse_opts(s):
    opts = {}
    if 'caption=' in s:
        s, cap = s.split('caption=', 1)
        opts['caption'] = cap.strip()
    for tok in s.split():
        if '=' in tok:
            k, v = tok.split('=', 1)
            opts[k] = v
    return opts


def parse(lines):
    blocks, i, n = [], 0, len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        if stripped.startswith('@@'):
            blocks.append({'type': stripped[2:].strip()})
            i += 1
            continue
        if stripped.startswith(':::'):
            head = stripped[3:].strip()
            kind, _, rest = head.partition(' ')
            body = []
            i += 1
            while i < n and lines[i].strip() != ':::':
                body.append(lines[i])
                i += 1
            i += 1
            blocks.append({'type': kind, 'opts': parse_opts(rest), 'body': body})
            continue
        m = HEAD_RE.match(stripped)
        if m:
            mark, title, ident = m.groups()
            if mark in ('#', '#!', '#A'):
                kind = {'#': 'num', '#!': 'plain', '#A': 'app'}[mark]
                blocks.append({'type': 'chapter', 'kind': kind, 'title': title, 'id': ident})
            elif mark == '##':
                blocks.append({'type': 'section', 'title': title, 'id': ident})
            else:
                blocks.append({'type': 'sub', 'title': title})
            i += 1
            continue
        m = ITEM_RE.match(stripped)
        if m:
            ordered = m.group(1) != '-'
            items = []
            while i < n:
                mm = ITEM_RE.match(lines[i].strip())
                if mm and (mm.group(1) != '-') == ordered:
                    items.append(mm.group(2))
                    i += 1
                elif lines[i].startswith('  ') and lines[i].strip() and items:
                    items[-1] += ' ' + lines[i].strip()
                    i += 1
                else:
                    break
            blocks.append({'type': 'list', 'ordered': ordered, 'items': items})
            continue
        para = []
        while i < n and lines[i].strip() and not lines[i].strip().startswith((':::', '@@')) \
                and not HEAD_RE.match(lines[i].strip()) and not ITEM_RE.match(lines[i].strip()):
            para.append(lines[i].strip())
            i += 1
        blocks.append({'type': 'para', 'text': ' '.join(para)})
    return blocks


def split_row(line):
    return [c.strip() for c in re.split(r'\s\|\s', ' ' + line.strip() + ' ')]


def prepare(blocks):
    """Assign chapter, section, table, figure and listing numbers and collect labels."""
    chap = app = 0
    cur, sec = None, 0
    counts = {}
    names = {'table': 'Table', 'figure': 'Figure', 'code': 'Listing'}
    for b in blocks:
        t = b['type']
        if t == 'chapter':
            sec, counts = 0, {}
            if b['kind'] == 'num':
                chap += 1
                cur = str(chap)
                b['num'], b['label'] = cur, 'Chapter %d' % chap
            elif b['kind'] == 'app':
                app += 1
                cur = chr(64 + app)
                b['num'], b['label'] = cur, 'Appendix %s' % cur
            else:
                cur = None
                b['num'], b['label'] = None, b['title']
            if b.get('id'):
                LABELS[b['id']] = b['label']
        elif t == 'section':
            if cur:
                sec += 1
                b['num'] = '%s.%d' % (cur, sec)
                if b.get('id'):
                    LABELS[b['id']] = 'Section %s' % b['num']
            else:
                b['num'] = None
        elif t in names and b['opts'].get('caption'):
            counts[t] = counts.get(t, 0) + 1
            b['num'] = '%s.%d' % (cur, counts[t]) if cur else str(counts[t])
            b['label'] = '%s %s' % (names[t], b['num'])
            if b['opts'].get('id'):
                LABELS[b['opts']['id']] = b['label']
        if t == 'table':
            rows, note = [], None
            for ln in b['body']:
                if not ln.strip():
                    continue
                if ln.strip().startswith('@note '):
                    note = ln.strip()[6:]
                else:
                    rows.append(split_row(ln))
            b['rows'], b['note'] = rows, note


def collect_citations(blocks):
    """Number references in the order in which the text cites them."""
    def scan(text):
        for part in re.split(r'(`[^`]*`)', text):
            if part.startswith('`'):
                continue
            for m in CITE_RE.finditer(part):
                _cite_numbers([k.strip().lstrip('@') for k in m.group(1).split(';')])
    for b in blocks:
        t = b['type']
        if t == 'para':
            scan(b['text'])
        elif t == 'list':
            for it in b['items']:
                scan(it)
        elif t == 'table':
            scan(b['opts'].get('caption', ''))
            for row in b['rows']:
                for cell in row:
                    scan(cell)
            if b['note']:
                scan(b['note'])
        elif t in ('figure', 'code'):
            scan(b['opts'].get('caption', ''))
        elif t == 'note':
            scan(' '.join(b['body']))


# --------------------------------------------------------------------------------------
# Document template: page numbers, table of contents, bookmarks
# --------------------------------------------------------------------------------------
STATE = {'body_start': None}


def roman(n):
    vals = [(1000, 'm'), (900, 'cm'), (500, 'd'), (400, 'cd'), (100, 'c'), (90, 'xc'),
            (50, 'l'), (40, 'xl'), (10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i')]
    out = ''
    for v, sym in vals:
        while n >= v:
            out += sym
            n -= v
    return out


def page_label(p):
    start = STATE['body_start']
    if start and p >= start:
        return str(p - start + 1)
    return roman(p)


class ListOf(TableOfContents):
    """A table of contents that listens for one kind of entry (tables or figures)."""

    def __init__(self, kind, **kw):
        TableOfContents.__init__(self, **kw)
        self._kind = kind

    def notify(self, kind, stuff):
        if kind == self._kind:
            self.addEntry(*stuff)


class ReportDoc(BaseDocTemplate):
    def __init__(self, filename, **kw):
        BaseDocTemplate.__init__(self, filename, pagesize=A4, leftMargin=MARGIN,
                                 rightMargin=MARGIN, topMargin=MARGIN, bottomMargin=MARGIN, **kw)

        def frame(name):
            return Frame(MARGIN, MARGIN, TEXT_W, TEXT_H, id=name, leftPadding=0,
                         rightPadding=0, topPadding=0, bottomPadding=0)

        self.addPageTemplates([
            PageTemplate(id='title', frames=[frame('t')], onPage=self._title_page),
            PageTemplate(id='front', frames=[frame('f')], onPage=self._front_page),
            PageTemplate(id='body', frames=[frame('b')], onPage=self._body_page),
        ])
        self._seq = 0
        self._body_start = None

    def beforeDocument(self):
        self._body_start = None
        self._seq = 0

    def _number(self, canv, text):
        canv.saveState()
        canv.setFont('TNR', 11)
        canv.drawCentredString(PAGE_W / 2.0, MARGIN - 30, text)
        canv.restoreState()

    def _title_page(self, canv, doc):
        try:
            canv.addPageLabel(0, 'ROMAN_LOWER', 1)
        except Exception:
            pass

    def _front_page(self, canv, doc):
        self._number(canv, roman(doc.page))

    def _body_page(self, canv, doc):
        if self._body_start is None:
            self._body_start = doc.page
            STATE['body_start'] = doc.page
            try:
                canv.addPageLabel(doc.page - 1, 'ARABIC', 1)
            except Exception:
                pass
        self._number(canv, str(doc.page - self._body_start + 1))

    def afterFlowable(self, flowable):
        entry = getattr(flowable, '_entry', None)
        if not entry:
            return
        kind, level, text, outline = entry
        self._seq += 1
        key = 'k%04d' % self._seq
        self.canv.bookmarkPage(key)
        if kind == 'TOCEntry':
            self.canv.addOutlineEntry(outline, key, level=level, closed=(level == 0))
        self.notify(kind, (level, text, self.page, key))


def tagged(par, kind, level, text, outline=None):
    par._entry = (kind, level, text, outline or text)
    return par


# --------------------------------------------------------------------------------------
# Turning blocks into flowables
# --------------------------------------------------------------------------------------
def make_table(b):
    opts, rows = b['opts'], b['rows']
    size = float(opts.get('size', 10))
    grid = opts.get('grid', 'yes') != 'no'
    header = opts.get('header', 'yes') != 'no'
    ncol = max(len(r) for r in rows)
    if 'widths' in opts:
        pct = [float(x) for x in opts['widths'].split(',')]
    else:
        pct = [100.0 / ncol] * ncol
    total_pct = float(opts.get('total', 100))
    widths = [TEXT_W * total_pct / 100.0 * p / sum(pct) for p in pct]
    cell = ParagraphStyle('cell', fontName='TNR', fontSize=size, leading=size * 1.24,
                          alignment=TA_LEFT)
    head = ParagraphStyle('head', parent=cell, fontName='TNR-Bold')
    data = []
    for r, row in enumerate(rows):
        row = row + [''] * (ncol - len(row))
        data.append([Paragraph(fmt(c, size), head if (header and r == 0) else cell)
                     for c in row])
    t = Table(data, colWidths=widths, repeatRows=1 if header else 0, hAlign='CENTER')
    style = [('VALIGN', (0, 0), (-1, -1), 'TOP'),
             ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
             ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 4)]
    if grid:
        style.append(('GRID', (0, 0), (-1, -1), 0.5, BLACK))
        if header:
            style.append(('LINEBELOW', (0, 0), (-1, 0), 1.1, BLACK))
    else:
        style += [('LEFTPADDING', (0, 0), (-1, -1), 0), ('TOPPADDING', (0, 0), (-1, -1), 1.5),
                  ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5)]
    t.setStyle(TableStyle(style))
    return t


def caption(b, kind):
    text = '<b>%s:</b> %s' % (b['label'], fmt(b['opts']['caption'], 11))
    par = Paragraph(text, S['caption'])
    listing = '%s: %s' % (b['label'], plain(b['opts']['caption']))
    if kind:
        tagged(par, kind, 0, esc(listing))
    return par


def title_page():
    c = COVER
    fl = [Spacer(1, 70)]
    fl.append(Paragraph(esc(c['title']), cover_style(22, 29, bold=True, after=14)))
    fl.append(Paragraph(esc(c['subtitle']), cover_style(17, 22, bold=True, after=46)))
    fl.append(Paragraph(esc(c['kind']), cover_style(15, 20, after=6)))
    if c.get('course'):
        fl.append(Paragraph(esc(c['course']), cover_style(14, 19, italic=True, after=0)))
    fl.append(Spacer(1, 70))
    if c.get('authors'):
        fl.append(Paragraph('Submitted by', cover_style(12.5, 17, italic=True, after=8)))
        rows = [[Paragraph(esc(n), cover_style(13, 17)), Paragraph(esc(r), cover_style(13, 17))]
                for n, r in c['authors']]
        has_roll = any(r for _, r in c['authors'])
        if has_roll:
            t = Table(rows, colWidths=[TEXT_W * 0.42, TEXT_W * 0.28], hAlign='CENTER')
        else:
            t = Table([[r[0]] for r in rows], colWidths=[TEXT_W * 0.7], hAlign='CENTER')
        t.setStyle(TableStyle([('TOPPADDING', (0, 0), (-1, -1), 2),
                               ('BOTTOMPADDING', (0, 0), (-1, -1), 2)]))
        fl.append(t)
        fl.append(Spacer(1, 40))
    if c.get('guide'):
        fl.append(Paragraph('Under the guidance of', cover_style(12.5, 17, italic=True, after=6)))
        fl.append(Paragraph(esc(c['guide']), cover_style(13, 17, after=40)))
    tail = []
    if c.get('department'):
        tail.append(Paragraph(esc(c['department']), cover_style(13.5, 18, bold=True, after=3)))
    if c.get('institution'):
        tail.append(Paragraph(esc(c['institution']), cover_style(13.5, 18, bold=True, after=10)))
    tail.append(Paragraph(esc(c['date']), cover_style(13, 17)))
    used = sum(f.wrap(TEXT_W, TEXT_H)[1] + getattr(getattr(f, 'style', None), 'spaceAfter', 0)
               for f in fl)
    tail_h = sum(f.wrap(TEXT_W, TEXT_H)[1] + f.style.spaceAfter for f in tail)
    fl.append(Spacer(1, max(12, TEXT_H - used - tail_h - 30)))
    fl.extend(tail)
    return fl


def build_story(blocks):
    story = []
    body_started = False
    first_chapter = True
    toc_objects = []

    def new_toc(kind=None):
        if kind:
            t = ListOf(kind)
            t.levelStyles = [S['lof']]
        else:
            t = TableOfContents()
            t.levelStyles = [S['toc0'], S['toc1']]
        t.dotsMinLevel = 0
        t.formatter = page_label
        toc_objects.append(t)
        return t

    for b in blocks:
        t = b['type']
        if t == 'titlepage':
            story.extend(title_page())
            story.append(NextPageTemplate('front'))
            story.append(PageBreak())
            first_chapter = True
        elif t == 'chapter':
            if b['kind'] == 'num' and not body_started:
                story.append(NextPageTemplate('body'))
                body_started = True
            if not first_chapter or body_started:
                if story and not isinstance(story[-1], PageBreak):
                    story.append(PageBreak())
            first_chapter = False
            title = fmt(b['title'], 19)
            if b['num']:
                story.append(Paragraph(b['label'], S['chaplabel']))
                if b['kind'] == 'app':
                    toc_text = '%s\u00a0\u00a0%s' % (b['label'], fmt(b['title']))
                else:
                    toc_text = '%s\u00a0\u00a0\u00a0%s' % (b['num'], fmt(b['title']))
                outline = '%s  %s' % (b['label'] if b['kind'] == 'app' else b['num'],
                                      plain(b['title']))
            else:
                toc_text, outline = fmt(b['title']), plain(b['title'])
            story.append(tagged(Paragraph(title, S['chaptitle']), 'TOCEntry', 0, toc_text,
                                outline))
        elif t in ('toc', 'lot', 'lof'):
            if story and not isinstance(story[-1], PageBreak):
                story.append(PageBreak())
            heading = {'toc': 'Table of Contents', 'lot': 'List of Tables',
                       'lof': 'List of Figures'}[t]
            par = Paragraph(heading, S['chaptitle'])
            if t != 'toc':
                tagged(par, 'TOCEntry', 0, heading)
            story.append(par)
            story.append(new_toc({'toc': None, 'lot': 'LOTEntry', 'lof': 'LOFEntry'}[t]))
            first_chapter = False
        elif t == 'section':
            text = fmt(b['title'], 13.5)
            if b['num']:
                shown = '%s\u00a0\u00a0\u00a0%s' % (b['num'], text)
                story.append(tagged(Paragraph(shown, S['h2']), 'TOCEntry', 1,
                                    '%s\u00a0\u00a0\u00a0%s' % (b['num'], fmt(b['title'])),
                                    '%s  %s' % (b['num'], plain(b['title']))))
            else:
                story.append(Paragraph(text, S['h2']))
        elif t == 'sub':
            story.append(Paragraph(fmt(b['title']), S['h3']))
        elif t == 'para':
            story.append(Paragraph(fmt(b['text']), S['body']))
        elif t == 'list':
            for k, item in enumerate(b['items']):
                bullet = '%d.' % (k + 1) if b['ordered'] else '\u2022'
                style = S['bullet']
                if k == len(b['items']) - 1:
                    style = ParagraphStyle('bullet_last', parent=S['bullet'], spaceAfter=8)
                story.append(Paragraph(fmt(item), style, bulletText=bullet))
        elif t == 'table':
            table = make_table(b)
            parts = []
            if b['opts'].get('caption'):
                parts.append(caption(b, 'LOTEntry'))
            parts.append(table)
            if b['note']:
                parts.append(Paragraph(fmt(b['note'], 10), S['note']))
            parts.append(Spacer(1, 12))
            height = table.wrap(TEXT_W, TEXT_H)[1]
            if height < TEXT_H * 0.62:
                story.append(KeepTogether(parts))
            else:
                story.append(CondPageBreak(130))
                story.extend(parts)
        elif t == 'figure':
            drawing = getattr(figures, b['opts']['fn'])(TEXT_W)
            drawing.hAlign = 'CENTER'
            story.append(KeepTogether([Spacer(1, 6), drawing, Spacer(1, 4),
                                       caption(b, 'LOFEntry'), Spacer(1, 8)]))
        elif t == 'code':
            text = '\n'.join(b['body']).rstrip()
            pre = Preformatted(text, S['code'])
            box = Table([[pre]], colWidths=[TEXT_W])
            box.setStyle(TableStyle([('BOX', (0, 0), (-1, -1), 0.5, BLACK),
                                     ('LEFTPADDING', (0, 0), (-1, -1), 7),
                                     ('RIGHTPADDING', (0, 0), (-1, -1), 5),
                                     ('TOPPADDING', (0, 0), (-1, -1), 6),
                                     ('BOTTOMPADDING', (0, 0), (-1, -1), 6)]))
            parts = []
            if b['opts'].get('caption'):
                parts.append(caption(b, None))
            parts += [box, Spacer(1, 12)]
            story.append(KeepTogether(parts))
        elif t == 'note':
            story.append(Paragraph(fmt(' '.join(x.strip() for x in b['body']), 10), S['note']))
            story.append(Spacer(1, 8))
        elif t == 'references':
            for n, key in enumerate(CITE_ORDER, 1):
                story.append(Paragraph(references.REFS[key], S['ref'], bulletText='[%d]' % n))
        elif t == 'pagebreak':
            story.append(PageBreak())
        else:
            raise ValueError('Unknown block type: %s' % t)
    return story


def main():
    blocks = parse(read_lines())
    prepare(blocks)
    collect_citations(blocks)
    story = build_story(blocks)
    unused = [k for k in references.REFS if k not in CITE_ORDER]
    if unused:
        print('Note: references defined but not cited:', ', '.join(unused))
    authors = ', '.join(n for n, _ in COVER.get('authors', []))
    doc = ReportDoc(OUT, title='%s: %s' % (COVER['title'], COVER['subtitle']),
                    author=authors, subject='%s, %s' % (COVER['kind'], COVER['course']),
                    keywords='OpenMRS, role-based access control, database security')
    doc.multiBuild(story)
    print('Wrote %s (%d references cited)' % (OUT, len(CITE_ORDER)))


if __name__ == '__main__':
    sys.exit(main())
