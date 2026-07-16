import { useMemo } from 'react';
import { companyNews, type CompanyNews, type NewsItem } from '../../data/news';

// Narrow "[company] in the news" card that sits to the right of the company
// card. Mirrors a mobile news feed: a trending hero with a masthead image, then
// a list of compact stories — no following tabs or notification bell.

function Meta({ item }: { item: NewsItem }) {
  return (
    <div className="newsmeta">
      <span>{item.cat}</span>
      <span className="newsmetadot">·</span>
      <span className="newsmetat">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" strokeLinecap="round" />
        </svg>
        {item.time}
      </span>
    </div>
  );
}

// Each headline is clickable — an article's own URL when we have it, otherwise
// a Google News search for that exact headline, which resolves to the real
// coverage. Opens in a new tab.
function articleUrl(item: NewsItem, name: string): string {
  return item.url || 'https://news.google.com/search?q=' + encodeURIComponent(`${item.title} ${name}`);
}

// Article image: the real image URL when the item carries one, otherwise a
// deterministic stock photo so the same story always shows the same picture.
function thumbUrl(seed: string, w: number, h: number): string {
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`;
}

// `live` (BHP) overrides the deterministic feed so comment counts tick with the
// poll; every other company falls back to the illustrative generated feed.
export function NewsPanel({ name, sector, live }: { name: string; sector: string; live?: CompanyNews | null }) {
  const computed = useMemo(() => companyNews(name, sector), [name, sector]);
  const news = live ?? computed;
  return (
    <aside className="newspanel">
      <div className="newshd">
        <span className="newshdname">{name}</span> in the news
      </div>
      <div className="newsscroll">
        <a className="newshero" href={articleUrl(news.hero, name)} target="_blank" rel="noreferrer">
          <div className="newsheroimg">
            <img className="newsheroimgtag" src={news.hero.image || thumbUrl(name + '-hero', 640, 360)} alt="" loading="lazy" />
            <span className="newsbadge">Trending</span>
          </div>
          <div className="newsherotitle">{news.hero.title}</div>
          <Meta item={news.hero} />
        </a>

        {news.items.map((a, i) => (
          <a className="newsrow" key={i} href={articleUrl(a, name)} target="_blank" rel="noreferrer">
            <div className="newsrowbody">
              <div className="newsrowcat">{a.cat}</div>
              <div className="newsrowtitle">{a.title}</div>
              <Meta item={a} />
            </div>
            <img className="newsrowthumb" src={a.image || thumbUrl(name + '-' + i, 160, 160)} alt="" loading="lazy" />
          </a>
        ))}
      </div>
    </aside>
  );
}
