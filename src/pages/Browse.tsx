import { useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Download, Loader2, RefreshCw, Search, Star } from "lucide-react";
import { api, errorText, formatCount, timeAgo, type SearchQuery } from "../api";
import { keys, useAction, useIndexInfo, useProfile, useSettings } from "../hooks";
import { useUi } from "../store";
import { ModIcon, PageHead } from "../components/Chrome";

const PAGE = 60;

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function BrowsePage() {
  const settings = useSettings().data;
  const index = useIndexInfo();
  const profile = useProfile(settings?.activeProfile).data;
  const { detail, openDetail, browseCategory } = useUi();
  const [text, setText] = useState("");
  const [category, setCategory] = useState(browseCategory ?? "");
  // Another page asked for a category (e.g. Profiles -> "From a modpack").
  useEffect(() => {
    if (browseCategory) {
      setCategory(browseCategory);
      useUi.setState({ browseCategory: null });
    }
  }, [browseCategory]);
  const [sort, setSort] = useState<SearchQuery["sort"]>("downloads");
  const q = useDebounced(text, 180);

  const categories = useQuery({
    queryKey: [...keys.categories, index.data?.fetchedAt],
    queryFn: api.categories,
    enabled: !!index.data?.loaded,
  });

  const results = useInfiniteQuery({
    queryKey: ["search", q, category, sort, settings?.showNsfw, settings?.showDeprecated, index.data?.fetchedAt],
    enabled: !!index.data?.loaded,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.search({
        text: q,
        category: category || null,
        sort,
        nsfw: settings?.showNsfw ?? false,
        deprecated: settings?.showDeprecated ?? false,
        offset: pageParam,
        limit: PAGE,
      }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });

  const items = useMemo(() => results.data?.pages.flatMap((p) => p.items) ?? [], [results.data]);
  const total = results.data?.pages[0]?.total ?? 0;
  const installed = useMemo(() => new Map(profile?.mods.map((m) => [m.fullName, m.version])), [profile]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const virt = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 82,
    overscan: 8,
  });
  const vItems = virt.getVirtualItems();

  useEffect(() => {
    const last = vItems[vItems.length - 1];
    if (last && last.index >= items.length - 12 && results.hasNextPage && !results.isFetchingNextPage) {
      results.fetchNextPage();
    }
  }, [vItems, items.length, results]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [q, category, sort]);

  const install = useAction((fullName: string) => api.installMod(settings!.activeProfile, fullName), {
    success: (p) => `Installed into ${p.name}`,
  });
  const refresh = useAction(() => api.refreshIndex(true), { success: (i) => `Mod list updated (${i.count} mods)` });
  const [pending, setPending] = useState<string | null>(null);

  return (
    <div className="page fill">
      <PageHead
        title="Browse Mods"
        sub={
          index.data?.loaded
            ? `${formatCount(index.data.count)} mods on Thunderstore · list updated ${timeAgo(index.data.fetchedAt)}`
            : "Loading the Thunderstore mod list…"
        }
        actions={
          <button className="btn" disabled={refresh.isPending} onClick={() => refresh.mutate([])}>
            <RefreshCw className={refresh.isPending ? "spin" : ""} /> Refresh list
          </button>
        }
      />
      <div className="toolbar">
        <div className="search-box">
          <Search />
          <input
            className="input"
            placeholder="Search mods, authors, descriptions…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoFocus
          />
        </div>
        <select className="select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          className="select"
          value={sort}
          onChange={(e) => setSort(e.target.value as SearchQuery["sort"])}
          aria-label="Sort"
        >
          <option value="downloads">Most downloaded</option>
          <option value="rating">Top rated</option>
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
        </select>
        <span className="faint" style={{ fontSize: 12.5 }}>
          {results.data ? `${total.toLocaleString()} results` : ""}
        </span>
      </div>

      <div className="list-scroll" ref={scrollRef}>
        {!index.data?.loaded ? (
          <div className="empty">
            <Loader2 className="spin" />
            <p>Downloading the mod list (about 15 MB, first time only)…</p>
          </div>
        ) : results.error ? (
          <div className="empty">
            <h3>Search failed</h3>
            <p>{errorText(results.error)}</p>
          </div>
        ) : items.length === 0 && !results.isLoading ? (
          <div className="empty">
            <span className="rune">ᛟ</span>
            <h3>Nothing found</h3>
            <p>Try fewer words or a different category.</p>
          </div>
        ) : (
          <div style={{ height: virt.getTotalSize(), position: "relative" }}>
            {vItems.map((v) => {
              const m = items[v.index];
              const have = installed.get(m.fullName);
              const busy = install.isPending && pending === m.fullName;
              return (
                <div
                  key={m.fullName}
                  data-index={v.index}
                  ref={virt.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, right: 0, transform: `translateY(${v.start}px)` }}
                >
                  <div
                    className={`mod-row${detail === m.fullName ? " selected" : ""}`}
                    onClick={() => openDetail(m.fullName)}
                  >
                    <ModIcon src={m.icon} name={m.name} />
                    <div className="mod-main">
                      <div className="mod-name">
                        {m.name.replace(/_/g, " ")}
                        <span className="owner">by {m.owner}</span>
                        {m.pinned && <span className="badge">Pinned</span>}
                        {m.deprecated && <span className="badge bad">Deprecated</span>}
                      </div>
                      <div className="mod-desc">{m.description}</div>
                    </div>
                    <div className="mod-stats">
                      <span>
                        <Download /> {formatCount(m.totalDownloads)}
                      </span>
                      <span>
                        <Star /> {m.rating}
                      </span>
                    </div>
                    <div className="mod-actions" style={{ width: 112, justifyContent: "flex-end" }}>
                      {have ? (
                        have === m.latest ? (
                          <span className="chip ok">
                            <Check /> Installed
                          </span>
                        ) : (
                          <span className="chip warn">Update</span>
                        )
                      ) : (
                        <button
                          className="btn sm primary"
                          disabled={install.isPending || !settings}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPending(m.fullName);
                            install.mutate([m.fullName]);
                          }}
                        >
                          {busy ? <Loader2 className="spin" /> : <Download />} Install
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {results.isFetchingNextPage && (
          <div className="row" style={{ justifyContent: "center", padding: 12 }}>
            <Loader2 className="spin" />
          </div>
        )}
      </div>
    </div>
  );
}
