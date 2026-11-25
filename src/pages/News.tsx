import { useEffect, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, WifiOff } from "lucide-react";
import { UpdateBanner } from "../components/UpdateBanner";
import { api, errorText, isNewer, type NewsItem } from "../api";
import { useNews } from "../hooks";
import { PageHead } from "../components/Chrome";
import { Md } from "../components/Markdown";
import { useQueryClient } from "@tanstack/react-query";

const fmtDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function NewsListItem({
  item,
  selected,
  isNew,
  installed,
  onClick,
}: {
  item: NewsItem;
  selected: boolean;
  isNew: boolean;
  installed: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`news-item${selected ? " selected" : ""}`} onClick={onClick}>
      <div className="row" style={{ gap: 6 }}>
        {item.patch ? <span className="badge">Patch {item.patch}</span> : <span className="badge muted">News</span>}
        {isNew && <span className="badge warn">Not installed</span>}
        {installed && <span className="badge ok">Your version</span>}
        <span className="spacer" />
        <span className="faint" style={{ fontSize: 12 }}>{fmtDate(item.date)}</span>
      </div>
      <div className="news-title">{item.title}</div>
      <div className="news-snippet">{item.body.replace(/[#*>`[\]()!]/g, "").slice(0, 140)}</div>
    </button>
  );
}

export function NewsPage() {
  const news = useNews();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const data = news.data;
  const items = data?.items ?? [];
  const current = items.find((i) => i.id === selected) ?? items[0];

  useEffect(() => {
    if (!selected && items[0]) setSelected(items[0].id);
  }, [items, selected]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData(["news"], await api.getNews(true));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="page fill">
      <PageHead
        title="Valheim News"
        sub="Patch notes and announcements from Iron Gate"
        actions={
          <button className="btn" disabled={refreshing} onClick={refresh}>
            <RefreshCw className={refreshing ? "spin" : ""} /> Refresh
          </button>
        }
      />
      {data && (
        <div className="stack" style={{ marginBottom: 14 }}>
          <UpdateBanner news={data} />
          {data.offline && (
            <div className="notice">
              <WifiOff style={{ color: "var(--text-faint)" }} /> Offline. Showing the news saved last time.
            </div>
          )}
        </div>
      )}
      {news.isLoading ? (
        <div className="empty">
          <Loader2 className="spin" />
        </div>
      ) : news.error ? (
        <div className="empty">
          <h3>Couldn't load the news</h3>
          <p>{errorText(news.error)}</p>
        </div>
      ) : (
        <div className="news-layout">
          <div className="news-list">
            {items.map((item) => (
              <NewsListItem
                key={item.id}
                item={item}
                selected={item.id === current?.id}
                isNew={!!(item.patch && data?.installedVersion && isNewer(item.patch, data.installedVersion))}
                installed={!!item.patch && item.patch === data?.installedVersion}
                onClick={() => setSelected(item.id)}
              />
            ))}
          </div>
          {current && (
            <article className="panel news-article">
              <div className="news-article-head">
                <div className="faint" style={{ fontSize: 12.5 }}>
                  {fmtDate(current.date)}
                  {current.author ? ` · ${current.author}` : ""}
                </div>
                <h2 className="display">{current.title}</h2>
                <button className="btn sm" onClick={() => api.openUrl(current.url)}>
                  <ExternalLink /> Open on Steam
                </button>
              </div>
              <Md>{current.body}</Md>
            </article>
          )}
        </div>
      )}
    </div>
  );
}
