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
      <span className="newsmetadot">·</span>
      <span className="newsmetat">
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth={2}>
          <path d="M4 5h16v11H9l-4 3v-3H4z" strokeLinejoin="round" />
        </svg>
        {item.comments}
      </span>
    </div>
  );
}

// Deterministic stock-photo placeholder per company/article, so the same
// company always shows the same set of images. Swap for a real news API's
// image URLs later.
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
        <article className="newshero">
          <div className="newsheroimg">
            <img className="newsheroimgtag" src={thumbUrl(name + '-hero', 640, 360)} alt="" loading="lazy" />
            <span className="newsbadge">Trending</span>
          </div>
          <div className="newsherotitle">{news.hero.title}</div>
          <Meta item={news.hero} />
        </article>

        {news.items.map((a, i) => (
          <article className="newsrow" key={i}>
            <div className="newsrowbody">
              <div className="newsrowcat">{a.cat}</div>
              <div className="newsrowtitle">{a.title}</div>
              <Meta item={a} />
            </div>
            <img className="newsrowthumb" src={thumbUrl(name + '-' + i, 160, 160)} alt="" loading="lazy" />
          </article>
        ))}
      </div>
    </aside>
  );
}
