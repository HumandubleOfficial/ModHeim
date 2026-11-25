import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, Download, ExternalLink, Globe, Loader2, Star, X } from "lucide-react";
import { api, errorText, formatBytes, formatCount, timeAgo, BEPINEX_PACK } from "../api";
import { useAction, useProfile, useSettings } from "../hooks";
import { useUi } from "../store";
import { ModIcon } from "./Chrome";
import { alertDialog, confirmDialog, promptDialog } from "./Dialogs";
import { Md } from "./Markdown";

export function PackageDrawer() {
  const { detail, openDetail } = useUi();
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && openDetail(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail, openDetail]);
  if (!detail) return null;
  return (
    <>
      <div className="drawer-backdrop" onClick={() => openDetail(null)} />
      <aside className="drawer" aria-label="Mod details">
        <DrawerContent fullName={detail} onClose={() => openDetail(null)} />
      </aside>
    </>
  );
}

function DrawerContent({ fullName, onClose }: { fullName: string; onClose: () => void }) {
  const activeName = useSettings().data?.activeProfile;
  const profile = useProfile(activeName).data;
  const pkg = useQuery({ queryKey: ["package", fullName], queryFn: () => api.getPackage(fullName) });
  const [version, setVersion] = useState<string>("");
  const p = pkg.data;
  const latest = p?.versions[0] ?? "";
  const chosen = version || latest;
  const readme = useQuery({
    queryKey: ["readme", fullName, latest],
    queryFn: () => api.getReadme(fullName, latest),
    enabled: !!latest,
    staleTime: Infinity,
  });
  const installed = profile?.mods.find((m) => m.fullName === fullName);
  const install = useAction(
    (v: string) => api.installMod(activeName!, fullName, v === latest ? undefined : v),
    { success: () => `Installed ${p?.name} into ${activeName}` },
  );
  const uninstall = useAction(() => api.uninstallMod(activeName!, fullName), {
    success: () => `Removed ${p?.name}`,
  });

  const installPack = useAction((name: string) => api.installModpack(fullName, name), {
    success: (r) => `Created "${r.name}" with ${r.installed} mods`,
  });

  useEffect(() => setVersion(""), [fullName]);

  const onInstallPack = async () => {
    const name = await promptDialog({
      title: "Install modpack as a new profile",
      body: (
        <>
          Sets up a separate profile with every mod in this pack, at the versions the pack asks for, plus its config
          files. Your other profiles aren't touched.
          <div className="notice warn" style={{ marginTop: 12 }}>
            Gameplay mods can add their own items and buildings to a world. Start a new world for a modpack, or back
            up your world first, before opening an existing one with it.
          </div>
        </>
      ),
      label: "Profile name",
      initial: p?.name.replace(/_/g, " ") ?? "",
      confirm: "Install",
    });
    if (!name) return;
    const r = await installPack.mutateAsync([name]).catch(() => null);
    if (!r) return;
    if (r.warnings.length) {
      await alertDialog({
        title: `Installed with ${r.warnings.length} warning${r.warnings.length > 1 ? "s" : ""}`,
        body: (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {r.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ),
      });
    }
    if (r.name !== activeName && (await confirmDialog({ title: `Switch to "${r.name}"?`, body: "Make the new profile the active one, so Play starts with this modpack.", confirm: "Switch" }))) {
      await api.setActiveProfile(r.name);
      useUi.getState().toast("success", `"${r.name}" is now active`);
      onClose();
    }
  };

  if (pkg.isLoading) {
    return (
      <div className="empty">
        <Loader2 className="spin" />
      </div>
    );
  }
  if (!p) {
    return (
      <div className="empty">
        <h3>Not found</h3>
        <p>{errorText(pkg.error)}</p>
      </div>
    );
  }
  const sameVersion = installed?.version === chosen;
  const isPack = p.categories.includes("Modpacks");
  const deps = p.dependencies.filter((d) => !d.startsWith(`${BEPINEX_PACK}-`));

  return (
    <>
      <button className="btn ghost icon drawer-close" onClick={onClose} aria-label="Close">
        <X />
      </button>
      <div className="drawer-head">
        <ModIcon src={p.icon} name={p.name} large />
        <div className="stack" style={{ gap: 6, minWidth: 0, paddingRight: 30 }}>
          <h2>{p.name.replace(/_/g, " ")}</h2>
          <div className="dim">by {p.owner}</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <span className="chip">
              <Download /> {formatCount(p.totalDownloads)}
            </span>
            <span className="chip">
              <Star /> {p.rating}
            </span>
            <span className="chip">Updated {timeAgo(p.dateUpdated)}</span>
            {p.deprecated && <span className="chip bad">Deprecated</span>}
          </div>
        </div>
      </div>
      <div className="drawer-body">
        <p className="selectable" style={{ marginTop: 0 }}>{p.description}</p>

        {isPack && (
          <div className="notice info modpack-callout">
            <Boxes />
            <div style={{ flex: 1 }}>
              <b>Modpack</b> · {p.dependencies.length} mods. Install it as its own profile so it doesn't mix with your
              current mods.
            </div>
            <button className="btn primary" disabled={installPack.isPending} onClick={onInstallPack}>
              {installPack.isPending ? <Loader2 className="spin" /> : <Boxes />} Install as new profile
            </button>
          </div>
        )}

        <div className="row wrap" style={{ margin: "14px 0 18px" }}>
          <select className="select" value={chosen} onChange={(e) => setVersion(e.target.value)} aria-label="Version">
            {p.versions.map((v, i) => (
              <option key={v} value={v}>
                {v}
                {i === 0 ? " (latest)" : ""}
                {installed?.version === v ? " • installed" : ""}
              </option>
            ))}
          </select>
          {installed && sameVersion ? (
            <span className="chip ok">Installed in {activeName}</span>
          ) : (
            <button
              className={`btn${isPack ? "" : " primary"}`}
              disabled={!activeName || install.isPending}
              onClick={() => install.mutate([chosen])}
            >
              {install.isPending ? <Loader2 className="spin" /> : <Download />}
              {installed ? `Switch to ${chosen}` : isPack ? `Add to ${activeName}` : "Install"}
            </button>
          )}
          {installed && fullName !== BEPINEX_PACK && (
            <button className="btn danger" disabled={uninstall.isPending} onClick={() => uninstall.mutate([])}>
              Uninstall
            </button>
          )}
          <span className="spacer" />
          {chosen === latest && (
            <span className="faint" style={{ fontSize: 12 }}>
              {formatBytes(p.size)}
            </span>
          )}
        </div>

        {deps.length > 0 && (
          <>
            <h2 className="section" style={{ marginTop: 0 }}>
              Requires <span className="muted">{chosen === latest ? "installed automatically" : "for the latest version; checked again when you install"}</span>
            </h2>
            <div className="dep-list">
              {deps.map((d) => {
                const name = d.split("-").slice(0, -1).join("-");
                const have = profile?.mods.some((m) => m.fullName === name);
                return (
                  <button
                    key={d}
                    className={`chip${have ? " ok" : ""}`}
                    style={{ cursor: "pointer" }}
                    onClick={() => useUi.getState().openDetail(name)}
                  >
                    {name.split("-")[1]?.replace(/_/g, " ") ?? name}
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="row wrap" style={{ marginTop: 16, gap: 6 }}>
          {p.categories.map((c) => (
            <span key={c} className="badge muted">
              {c}
            </span>
          ))}
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn sm" onClick={() => api.openUrl(p.url)}>
            <ExternalLink /> Thunderstore
          </button>
          {p.website && (
            <button className="btn sm" onClick={() => api.openUrl(p.website)}>
              <Globe /> Website
            </button>
          )}
        </div>

        <h2 className="section">Readme</h2>
        {readme.isLoading && <Loader2 className="spin" />}
        {readme.error && <p className="faint">Couldn't load the readme: {errorText(readme.error)}</p>}
        {readme.data && (
          <Md>{readme.data}</Md>
        )}
      </div>
    </>
  );
}
