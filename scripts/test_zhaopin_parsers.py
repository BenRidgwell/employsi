#!/usr/bin/env python3
"""zhaopin_company_scraper.parse_search_html — the Zhaopin page reader.

WHAT THIS GUARDS, and it is not "the markup is still this". It guards the two
things that are ours: that the parser reads a results page into the exact dict
upsert() expects, and that A CHALLENGE PAGE PARSES TO NOTHING.

The second is the one that matters. Zhaopin's "Security Verification"
interstitial is an HTTP 200 with an ordinary-looking body — measured at 1,930
bytes on 2026-09-29 — so a parser that scraped a single stray element out of one
would file invented vacancies against a real Chinese company and the run would
go green. The feed's red-on-zero-rows guard cannot help there, because rows
would exist.

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


# ── 1. a results page reads into upsert()'s dict ─────────────────────────────
# Shape of what sou.zhaopin.com embeds: the fe-api records hang off
# window.__INITIAL_STATE__ and carry a positionURL, which is what the deep scan
# keys on. Confirmed live 2026-09-29 — the first run through a China exit
# reported `__INITIAL_STATE__×13`.
STATE = {'x': {'jobList': [
    {'positionURL': 'https://jobs.zhaopin.com/CC222.htm',
     'name': '算法工程师', 'companyName': '腾讯科技',
     'cityDistrict': '深圳·南山区', 'salary60': '30K-50K',
     'publishTime': '2026-09-28 10:00:00'},
    {'positionURL': 'https://jobs.zhaopin.com/CC333.htm',
     'name': '数据分析师', 'companyName': '腾讯科技',
     'cityDistrict': '北京·海淀区', 'salary60': '20K-35K',
     'publishTime': '2026-09-27 09:00:00'},
]}}
STATE_HTML = ('<script>window.__INITIAL_STATE__='
              + json.dumps(STATE, ensure_ascii=False) + ';</script>')
jobs = zp.parse_search_html(STATE_HTML)
check(len(jobs) == 2, f'expected 2 jobs, got {len(jobs)}')
if jobs:
    check(jobs[0]['t'] == '算法工程师', f"title wrong: {jobs[0]['t']!r}")
    check(jobs[0]['company'] == '腾讯科技', f"company wrong: {jobs[0]['company']!r}")
    check(jobs[0]['loc'] == '深圳·南山区', f"location wrong: {jobs[0]['loc']!r}")
    # upsert() reads exactly these keys; a rename here writes NULLs, not an error.
    for j in jobs:
        for k in ('t', 'company', 'loc', 'url', 'date'):
            check(k in j, f'job dict missing {k!r} that upsert() reads')
    # posted is stored as a date, not a timestamp — job_key does not use it, but
    # the card renders it.
    check(jobs[0]['date'] == '2026-09-28', f"date not truncated: {jobs[0]['date']!r}")

# Records without a positionURL are not vacancies and must not become rows.
NO_URL = '<script>window.__INITIAL_STATE__=' + json.dumps(
    {'x': {'banner': [{'name': '广告位', 'companyName': '某公司'}]}}, ensure_ascii=False) + ';</script>'
check(zp.parse_search_html(NO_URL) == [], 'a record with no positionURL became a job')


# ── 2. THE ONE THAT MATTERS: a challenge page yields nothing ─────────────────
# Shape of the real interstitial served to a refused address, measured
# 2026-09-29. It even carries job-ish markup, because a parser that keys on
# "looks like a listing" is the mistake being guarded against.
CHALLENGE = ('<!doctype html><html lang="en"><meta charset="utf-8">'
             '<title>Security Verification</title><style>body{margin:0}</style>'
             '<div class="content"><h1>验证</h1><p>captcha</p>'
             '<div class="joblist-box__item"><span class="jobinfo__name">请完成安全验证</span>'
             '<span class="companyinfo__name">智联招聘</span></div></div>')
check(zp.parse_search_html(CHALLENGE) == [], 'parser found rows in a CHALLENGE page')

for junk in ('', '<html></html>', 'not html at all', '{"json":true}',
             '<script>window.__INITIAL_STATE__={broken</script>'):
    check(zp.parse_search_html(junk) == [], f'parser invented rows from {junk[:24]!r}')


if fails:
    print(f'FAIL — {len(fails)} assertion(s):')
    for f in fails:
        print(f'  - {f}')
    sys.exit(1)
print(f'ok — zhaopin parser: {len(jobs)} rows read into upsert()\'s shape; '
      f'challenge, junk and malformed pages all yield nothing.')
