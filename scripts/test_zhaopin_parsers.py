#!/usr/bin/env python3
"""zhaopin_company_scraper's two page parsers.

WHY TWO. No one here has loaded a real Zhaopin results page since the Oxylabs
credential died on 2026-08-28 — every address reachable from CI gets a
"Security Verification" interstitial instead (1,930 bytes, measured
2026-09-29). So the feed ships both readings of the page: the
__INITIAL_STATE__ JSON the Oxylabs-rendered page carried when it last worked,
and the CSS-selector reading ported from jiangyuxue666/job-market-analyzer
(MIT). The first real run through a China exit reports which one fired.

WHAT THIS GUARDS. Not "the markup is still this" — nobody can assert that from
here. It guards the two things that are ours: that each parser reads the shape
it claims to, into the exact dict upsert() expects, and that a CHALLENGE PAGE
PARSES TO NOTHING. The second matters most: an interstitial is HTTP 200 with a
normal-looking body, so a parser that scraped a stray element out of one would
put invented rows on a Chinese company's card and the run would go green.

Run: python scripts/test_zhaopin_parsers.py
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools', 'zhaopin-company-scraper'))
import zhaopin_company_scraper as zp  # noqa: E402

fails: list[str] = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


# ── 1. the card parser reads the upstream selectors ──────────────────────────
# Markup built from the selector contract in app/parsers/zhaopin.py upstream:
# .joblist-box__item wraps a card; .jobinfo__other-info-item is an ORDERED
# triple (location, experience, education) and only the first is archived.
CARD_HTML = """
<div class="joblist-box">
  <div class="joblist-box__item">
    <a href="//jobs.zhaopin.com/CC000.htm">
      <span class="jobinfo__name">高级后端工程师</span>
      <span class="jobinfo__salary">25K-40K·14薪</span>
      <div class="jobinfo__other-info">
        <span class="jobinfo__other-info-item">深圳·南山区</span>
        <span class="jobinfo__other-info-item">5-10年</span>
        <span class="jobinfo__other-info-item">本科</span>
      </div>
      <span class="companyinfo__name">华为技术有限公司</span>
    </a>
  </div>
  <div class="joblist-box__item">
    <a href="https://jobs.zhaopin.com/CC111.htm">
      <span class="jobinfo__name">数据分析师</span>
      <span class="jobinfo__salary">15K-25K</span>
      <div class="jobinfo__other-info">
        <span class="jobinfo__other-info-item">北京·海淀区</span>
      </div>
      <span class="companyinfo__name">华为技术有限公司</span>
    </a>
  </div>
  <div class="joblist-box__item"><span class="jobinfo__salary">20K</span></div>
</div>
"""
cards = zp.parse_cards_html(CARD_HTML)
if not cards:
    # bs4 absent is a skip for this half, not a silent pass for the file.
    try:
        import bs4  # noqa: F401
        fails.append('parse_cards_html returned nothing with bs4 installed')
    except ImportError:
        print('  (skipped card-parser assertions: bs4 not installed)')
else:
    check(len(cards) == 2, f'expected 2 cards (third has no title), got {len(cards)}')
    a = cards[0]
    check(a['t'] == '高级后端工程师', f"title wrong: {a['t']!r}")
    check(a['company'] == '华为技术有限公司', f"company wrong: {a['company']!r}")
    check(a['loc'] == '深圳·南山区', f"location wrong: {a['loc']!r}")
    check(a['salary'] == '25K-40K·14薪', f"salary wrong: {a['salary']!r}")
    # A protocol-relative href must become absolute, or the stored url 404s.
    check(a['url'] == 'https://jobs.zhaopin.com/CC000.htm', f"url wrong: {a['url']!r}")
    check(cards[1]['url'] == 'https://jobs.zhaopin.com/CC111.htm', 'absolute href mangled')
    # A card with no title is not a vacancy; it must be dropped, not stored blank.
    check(all(c['t'] for c in cards), 'a card with no .jobinfo__name was kept')
    # upsert() reads exactly these keys.
    for c in cards:
        for k in ('t', 'company', 'loc', 'salary', 'url', 'date'):
            check(k in c, f'card dict missing {k!r} that upsert() reads')

    # Only the FIRST other-info item is the location. If that ordering is ever
    # "simplified" to a join, every Chinese row gains an experience band and a
    # degree requirement inside its location, and job_key changes with it —
    # which silently re-keys the whole feed and doubles it in the archive.
    check('5-10年' not in cards[0]['loc'], 'experience leaked into location')
    check('本科' not in cards[0]['loc'], 'education leaked into location')


# ── 2. the JSON parser still reads __INITIAL_STATE__ ─────────────────────────
STATE = {'x': {'jobList': [{
    'positionURL': 'https://jobs.zhaopin.com/CC222.htm',
    'name': '算法工程师', 'companyName': '腾讯科技',
    'cityDistrict': '深圳·南山区', 'salary60': '30K-50K',
    'publishTime': '2026-09-28 10:00:00',
}]}}
STATE_HTML = '<script>window.__INITIAL_STATE__=' + json.dumps(STATE, ensure_ascii=False) + ';</script>'
state_jobs = zp.parse_search_html(STATE_HTML)
check(len(state_jobs) == 1, f'__INITIAL_STATE__ parser got {len(state_jobs)} jobs, expected 1')
if state_jobs:
    check(state_jobs[0]['t'] == '算法工程师', f"state title wrong: {state_jobs[0]['t']!r}")
    for k in ('t', 'company', 'loc', 'url', 'date'):
        check(k in state_jobs[0], f'state dict missing {k!r} that upsert() reads')


# ── 3. THE ONE THAT MATTERS: a challenge page yields nothing ─────────────────
# Shape of the real interstitial served to CI's address, measured 2026-09-29.
# Both parsers must return [] — a challenge that parsed to even one row would
# put a fabricated vacancy on a real company's card, green.
CHALLENGE = ('<!doctype html><html lang="en"><meta charset="utf-8">'
             '<title>Security Verification</title><style>body{margin:0}</style>'
             '<div class="content"><h1>验证</h1><p>captcha</p>'
             '<div class="joblist-box__item"><span>请完成安全验证</span></div></div>')
check(zp.parse_cards_html(CHALLENGE) == [], 'card parser found rows in a CHALLENGE page')
check(zp.parse_search_html(CHALLENGE) == [], 'state parser found rows in a CHALLENGE page')

for junk in ('', '<html></html>', 'not html at all', '{"json":true}'):
    check(zp.parse_cards_html(junk) == [], f'card parser invented rows from {junk[:20]!r}')
    check(zp.parse_search_html(junk) == [], f'state parser invented rows from {junk[:20]!r}')


if fails:
    print(f'FAIL — {len(fails)} assertion(s):')
    for f in fails:
        print(f'  - {f}')
    sys.exit(1)
print(f'ok — zhaopin parsers: {len(cards)} cards, {len(state_jobs)} state row(s), '
      f'challenge and junk pages yield nothing from both.')
