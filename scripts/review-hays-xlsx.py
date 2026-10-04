#!/usr/bin/env python3
"""scripts/hays-role-review.tsv -> a workbook to review it in.

Run: python3 scripts/review-hays-xlsx.py [in.tsv] [out.xlsx]

THE TSV STAYS THE SOURCE. `bun run scripts/review-hays-roles.ts` regenerates it
from the data file and the app's own placeTitle; this script only dresses it for
a human. Regenerating the TSV after decisions have been entered would overwrite
them, so the workbook — not the TSV — is what comes back filled in.

ONLY COLUMN A IS EDITABLE. It is the one with a yellow fill, and the legend on
the first sheet says so; everything else is the proposal being judged. The
dropdown offers "ok" and "no" but does NOT reject other entries, because the
third answer a reviewer needs is a corrected node typed in by hand, and a
validation that blocked it would make the common correction the hard one.
"""
from __future__ import annotations
import csv
import os
import re
import sys

try:
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter
    from openpyxl.worksheet.datavalidation import DataValidation
except ImportError:
    sys.exit('needs openpyxl: pip install openpyxl')

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'hays-role-review.tsv')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'hays-role-review.xlsx')

FONT = 'Arial'
INK = Font(name=FONT, size=10)
BOLD = Font(name=FONT, size=10, bold=True)
HEAD = Font(name=FONT, size=10, bold=True, color='FFFFFF')
TITLE = Font(name=FONT, size=13, bold=True)
MUTED = Font(name=FONT, size=10, color='595959')
EDIT_FILL = PatternFill('solid', fgColor='FFF2CC')      # the cells to fill in
HEAD_FILL = PatternFill('solid', fgColor='1F3864')
ODD_FILL = PatternFill('solid', fgColor='FCE4D6')       # section_odd = Y
CONF_FILL = {
    'exact': PatternFill('solid', fgColor='E2EFDA'),
    'placed': PatternFill('solid', fgColor='FFF2CC'),
    'hinted': PatternFill('solid', fgColor='FBE5D6'),
    'none': PatternFill('solid', fgColor='F2F2F2'),
}
THIN = Side(style='thin', color='BFBFBF')
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def read_rows(path: str):
    with open(path, encoding='utf-8') as f:
        lines = [l for l in f if not l.startswith('#') and l.strip()]
    return list(csv.DictReader(lines, delimiter='\t'))


def band_ends(band: str):
    """'61-130k' -> (61, 130). Kept as NUMBERS beside the text so a reviewer can
    sort and filter on them; the text is kept because it is what the guide
    reads like."""
    m = re.match(r'^\s*([\d.]+)\s*-\s*([\d.]+)', band or '')
    return (float(m.group(1)), float(m.group(2))) if m else (None, None)


def main() -> int:
    rows = read_rows(SRC)
    if not rows:
        sys.exit(f'no rows in {SRC}')

    wb = Workbook()

    # ── sheet 1: how to use it ───────────────────────────────────────────────
    gd = wb.active
    gd.title = 'How to use'
    gd.sheet_properties.tabColor = '1F3864'
    lines = [
        (TITLE, 'Hays Salary Guide roles → career rungs'),
        (MUTED, 'Proposed by scripts/review-hays-roles.ts. The proposal is not the mapping — this review is.'),
        (None, ''),
        (BOLD, 'What to do'),
        (INK, '1. Work the "Review" sheet. Fill column A (DECISION) — the yellow column, the only one to edit.'),
        (INK, '2. Start with the rows where section_odd = Y. They are shaded, and they are where the errors are.'),
        (INK, '3. Send the workbook back. Progress on the third sheet updates as you go.'),
        (None, ''),
        (BOLD, 'What to put in DECISION'),
        (INK, '   ok                     accept the proposed_node as shown'),
        (INK, '   no                     map nothing — the role contributes no salary anywhere'),
        (INK, '   family|track|rung      a correction, e.g. hr|generalist|4'),
        (INK, '   (blank)                undecided. Treated exactly like "no" until it is filled in.'),
        (MUTED, 'Undecided is safe: a role with no decision is simply left off, the way a career rung the'),
        (MUTED, 'O*NET table has not decided is left off the card. Nothing is guessed.'),
        (None, ''),
        (BOLD, 'Example'),
        (None, ''),
        (BOLD, 'How confident the proposal is'),
        (INK, '   exact    the cleaned role name is a title the rung ALREADY carries in the archive —'),
        (INK, '            real ads with that exact name, placed on that rung. The strongest evidence.'),
        (INK, '   placed   placeTitle put it somewhere, but no archived ad carries the name.'),
        (INK, '            Plausible and unconfirmed. This is the bucket worth your time.'),
        (INK, '   hinted   the family is known, the rung is not. proposed_node reads like hr|?|?'),
        (INK, '   none     nothing proposed. Many of these are not roles at all — the PDF conversion'),
        (INK, '            split headers, so "EXPERIENCE" and "NO EXP" appear as role names. Mark them no.'),
        (None, ''),
        (BOLD, 'section_odd'),
        (INK, 'Roles under one Hays heading almost all place into the same family. A role that disagrees'),
        (INK, "with its own section's majority is flagged Y. Derived from the data, not a hand-written map."),
        (None, ''),
        (BOLD, 'What the numbers are — read before judging a band'),
        (INK, '   • THOUSANDS. A band of 61-130k is $61,000 to $130,000.'),
        (INK, '   • EXCLUDING superannuation (AU) and KiwiSaver (NZ) — the guide says so on every table.'),
        (INK, '     An advertised "package" usually includes super, so these are not the same quantity.'),
        (INK, '   • Australian cities are AUD and New Zealand cities are NZD, in the same band column.'),
        (INK, '   • The band here spans every city and edition for the role — it is context for judging'),
        (INK, '     the mapping, not the figure that would be shown. The per-city figures live in'),
        (INK, '     src/employsi/data/haysSalary.ts.'),
        (None, ''),
        (MUTED, 'Source: Hays Salary Guide (Hays Specialist Recruitment), editions FY22/23, 2023, FY24/25,'),
        (MUTED, 'from workbooks supplied by the repo owner. Credit travels with the figures: any surface'),
        (MUTED, 'showing one names the guide and its edition.'),
    ]
    r = 1
    example_at = None
    for font, text in lines:
        if font is BOLD and text == 'Example':
            gd.cell(r, 1, text).font = BOLD
            example_at = r + 1
            r += 2
            continue
        c = gd.cell(r, 1, text)
        if font:
            c.font = font
        r += 1
    gd.column_dimensions['A'].width = 100

    # The one example row the legend promises: realistic values, clearly a
    # sample, and on THIS sheet rather than inside the data where it would have
    # to be deleted before the file could be read back.
    ex_head = ['DECISION', 'confidence', 'section_odd', 'hays_role', 'proposed_node', 'figures', 'band']
    ex_row = ['hr|generalist|4', 'placed', 'Y', 'HR MANAGER', 'hr|generalist|3', 14, '95-160k']
    for j, (h, v) in enumerate(zip(ex_head, ex_row), start=1):
        hc = gd.cell(example_at, j, h)
        hc.font = HEAD
        hc.fill = HEAD_FILL
        hc.border = BOX
        vc = gd.cell(example_at + 1, j, v)
        vc.font = INK
        vc.border = BOX
        if j == 1:
            vc.fill = EDIT_FILL
    gd.cell(example_at + 2, 1, 'A correction typed over the proposal: the reviewer judged it a rung higher.').font = MUTED

    # ── sheet 2: the review itself ───────────────────────────────────────────
    ws = wb.create_sheet('Review')
    headers = [
        'DECISION', 'confidence', 'section_odd', 'hays_role', 'hays_band', 'hays_section',
        'proposed_node', 'rung', 'canonical', 'via', 'figures', 'band', 'band_lo_k',
        'band_hi_k', 'editions',
    ]
    widths = [18, 11, 11, 42, 18, 26, 26, 17, 30, 9, 9, 12, 11, 11, 18]
    for j, (h, w) in enumerate(zip(headers, widths), start=1):
        c = ws.cell(1, j, h)
        c.font = HEAD
        c.fill = HEAD_FILL
        c.border = BOX
        c.alignment = Alignment(vertical='center', wrap_text=True)
        ws.column_dimensions[get_column_letter(j)].width = w
    ws.row_dimensions[1].height = 26

    for i, r0 in enumerate(rows, start=2):
        lo, hi = band_ends(r0.get('band', ''))
        vals = [
            r0.get('DECISION', ''), r0['confidence'], r0['section_odd'], r0['hays_role'],
            r0.get('hays_band', ''), r0['hays_section'], r0['proposed_node'], r0['rung'],
            r0['canonical'], r0['via'], int(r0['figures'] or 0), r0['band'], lo, hi,
            r0['editions'],
        ]
        for j, v in enumerate(vals, start=1):
            c = ws.cell(i, j, v)
            c.font = INK
            c.border = BOX
            if j == 1:
                c.fill = EDIT_FILL
            elif j == 2:
                c.fill = CONF_FILL.get(r0['confidence'], CONF_FILL['none'])
            elif j == 3 and r0['section_odd'] == 'Y':
                c.fill = ODD_FILL
            if j in (11, 13, 14):
                c.number_format = '#,##0'
                c.alignment = Alignment(horizontal='right')

    last = len(rows) + 1
    ws.freeze_panes = 'B2'           # header and the DECISION column stay put
    ws.auto_filter.ref = f'A1:{get_column_letter(len(headers))}{last}'
    # showErrorMessage=False on purpose: the list is a convenience, and a typed
    # node must still be accepted. See the module docstring.
    dv = DataValidation(type='list', formula1='"ok,no"', allow_blank=True, showErrorMessage=False)
    dv.prompt = 'ok, no, or a family|track|rung to correct it'
    dv.promptTitle = 'Decision'
    ws.add_data_validation(dv)
    dv.add(f'A2:A{last}')

    # ── sheet 3: progress, in formulas so it moves as decisions are entered ───
    pg = wb.create_sheet('Progress')
    pg.cell(1, 1, 'Progress').font = TITLE
    pg.cell(2, 1, 'Live from the Review sheet — these recalculate as you fill DECISION in.').font = MUTED
    head = ['confidence', 'roles', 'decided', 'left', 'figures', 'figures decided',
            'check: roles', 'check: figures']
    for j, h in enumerate(head, start=1):
        c = pg.cell(4, j, h)
        c.font = HEAD
        c.fill = HEAD_FILL
        c.border = BOX
    # THE CHECK COLUMNS EXIST BECAUSE THE FORMULAS COULD NOT BE EXECUTED HERE.
    # The xlsx workflow recalculates a new workbook through LibreOffice before
    # shipping it; in this sandbox LibreOffice headless does not complete a
    # conversion at all — a three-cell workbook timed out at 120s, so it is the
    # environment and not this file. The formulas are therefore unverified BY
    # EXECUTION, and shipping an unverified number with nothing to check it
    # against is not something to do quietly.
    #
    # So the same two totals are also computed in Python, from the same rows,
    # and written beside them. They cannot drift: a formula that misfires shows
    # up as a disagreement with the column next to it the moment the file opens.
    # `roles` and `figures` are the pair worth checking — they are fixed at
    # generation, where `decided` and `left` are meant to move as the review
    # proceeds and so have nothing static to compare against.
    counts = {b: 0 for b in ('exact', 'placed', 'hinted', 'none')}
    figs = {b: 0 for b in counts}
    for r0 in rows:
        b = r0['confidence']
        if b in counts:
            counts[b] += 1
            figs[b] += int(r0['figures'] or 0)
    for i, bucket in enumerate(['exact', 'placed', 'hinted', 'none'], start=5):
        pg.cell(i, 1, bucket).font = INK
        pg.cell(i, 2, f'=COUNTIF(Review!$B$2:$B${last},A{i})').font = INK
        pg.cell(i, 3, f'=COUNTIFS(Review!$B$2:$B${last},A{i},Review!$A$2:$A${last},"<>")').font = INK
        pg.cell(i, 4, f'=B{i}-C{i}').font = INK
        pg.cell(i, 5, f'=SUMIF(Review!$B$2:$B${last},A{i},Review!$K$2:$K${last})').font = INK
        pg.cell(i, 6, f'=SUMIFS(Review!$K$2:$K${last},Review!$B$2:$B${last},A{i},'
                      f'Review!$A$2:$A${last},"<>")').font = INK
        pg.cell(i, 7, counts[bucket]).font = MUTED
        pg.cell(i, 8, figs[bucket]).font = MUTED
        for j in range(1, 9):
            pg.cell(i, j).border = BOX
            if j > 1:
                pg.cell(i, j).number_format = '#,##0'
    tot = 9
    pg.cell(tot, 1, 'TOTAL').font = BOLD
    for j, col in enumerate('BCDEF', start=2):
        pg.cell(tot, j, f'=SUM({col}5:{col}8)').font = BOLD
        pg.cell(tot, j).number_format = '#,##0'
        pg.cell(tot, j).border = BOX
    pg.cell(tot, 1).border = BOX
    pg.cell(11, 1, 'section_odd still undecided').font = BOLD
    pg.cell(11, 3, f'=COUNTIFS(Review!$C$2:$C${last},"Y",Review!$A$2:$A${last},"")').font = BOLD
    pg.cell(11, 3).border = BOX
    pg.cell(12, 1, 'Read those first — they disagree with their own section.').font = MUTED
    pg.cell(14, 1, 'The two "check" columns were computed when this file was made. If a formula '
                   'beside one disagrees with it, trust the check and tell me.').font = MUTED
    for j, w in enumerate([30, 10, 10, 10, 12, 16, 13, 14], start=1):
        pg.column_dimensions[get_column_letter(j)].width = w

    wb.save(OUT)
    sys.stderr.write(f'wrote {OUT} — {len(rows)} roles\n')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
