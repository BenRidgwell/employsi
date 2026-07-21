"""
SEEK network sites and regions for the company scraper.

Repurposed from the original SeekSpider `core/regions.py`, which listed only
Australian cities. SEEK runs one search API (`/api/jobsearch/v5/search`) per
country site, each with its own `siteKey`, host and location vocabulary, so a
"region" here is a (site, where-string) pair.

Two things to know when scraping a company across regions:

  * `where="All <Country>"` already returns every region in that country in one
    pass, and each job carries its own `locations[].label`, so you get
    per-region data for free. Scoping to a single city (e.g. "All Perth WA") is
    only needed to *narrow* results.

  * Advertiser IDs are per-site. A company's `advertiserid` on seek.com.au is
    not the same as on seek.co.nz, so the company must be resolved separately on
    each site (the scraper does this automatically).
"""

# One entry per SEEK country site.
SITES = {
    'au': {
        'host': 'www.seek.com.au',
        'site_key': 'AU-Main',
        'locale': 'en-AU',
        'all': 'All Australia',
    },
    'nz': {
        'host': 'www.seek.co.nz',
        'site_key': 'NZ-Main',
        'locale': 'en-NZ',
        'all': 'All New Zealand',
    },
}

DEFAULT_SITE = 'au'

# Named regions (city scoping) per site. Keys are what you pass to --region.
# Repurposed 1:1 from the original SeekSpider AUSTRALIAN_REGIONS, plus a
# whole-of-country default and the NZ equivalents.
REGIONS = {
    'au': {
        'All Australia': 'All Australia',
        # Western Australia
        'Perth': 'All Perth WA',
        # New South Wales
        'Sydney': 'All Sydney NSW',
        # Victoria
        'Melbourne': 'All Melbourne VIC',
        # Queensland
        'Brisbane': 'All Brisbane QLD',
        'Gold Coast': 'All Gold Coast QLD',
        # South Australia
        'Adelaide': 'All Adelaide SA',
        # Australian Capital Territory
        'Canberra': 'All Canberra ACT',
        # Tasmania
        'Hobart': 'All Hobart TAS',
        # Northern Territory
        'Darwin': 'All Darwin NT',
    },
    'nz': {
        'All New Zealand': 'All New Zealand',
        'Auckland': 'All Auckland',
        'Wellington': 'All Wellington',
        'Christchurch': 'All Canterbury',
    },
}


def get_site(site: str) -> dict:
    """Return the site config for a site key (e.g. 'au'), defaulting sensibly."""
    return SITES.get(site, SITES[DEFAULT_SITE])


def get_all_sites() -> list:
    """Return every supported site key."""
    return list(SITES.keys())


def get_regions(site: str) -> dict:
    """Return the {region_name: where_string} map for a site."""
    return REGIONS.get(site, {})


def get_where(site: str, region: str | None) -> str:
    """
    Resolve a region name to its SEEK `where` string for a site.

    None / unknown region falls back to the whole country ("All <Country>").
    """
    regions = get_regions(site)
    if region and region in regions:
        return regions[region]
    return get_site(site)['all']


def is_valid_region(site: str, region: str) -> bool:
    """Check a region name is known for a site."""
    return region in get_regions(site)
