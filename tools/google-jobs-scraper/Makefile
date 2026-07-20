# Convenience targets for the Google Jobs scraper.
#
#   make scrape QUERY="data engineer"          # free Playwright method
#   make api    QUERY="BHP" GEO="Perth,Western Australia,Australia"  # Oxylabs API
#
# COUNTRY defaults to au; override on the command line (COUNTRY=us, gb, ...).

QUERY   ?= data engineer
COUNTRY ?= au
GEO     ?=
OUT     ?= jobs.csv

.PHONY: install scrape api

install:
	pip install -r requirements.txt
	playwright install chromium

scrape:
	python free_google_jobs.py "$(QUERY)" --country $(COUNTRY) --out $(OUT)

api:
	python oxylabs_google_jobs.py "$(QUERY)" --country $(COUNTRY) --geo "$(GEO)" --out $(OUT)
