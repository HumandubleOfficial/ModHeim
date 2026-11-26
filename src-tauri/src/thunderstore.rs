//! Thunderstore package index: fetch, cache, search, dependency resolution, downloads.

use std::collections::{BTreeMap, HashMap, VecDeque};
use std::io::Write;
use std::path::{Path, PathBuf};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};

use crate::error::{AppError, Result};
use crate::settings::{cache_dir, package_cache_dir, write_json_atomic};

pub const INDEX_URL: &str = "https://thunderstore.io/c/valheim/api/v1/package/";
pub const BEPINEX_PACK: &str = "denikson-BepInExPack_Valheim";
pub const USER_AGENT: &str = concat!("ModHeim/", env!("CARGO_PKG_VERSION"));

// ------------------------------------------------------------ raw API shape

#[derive(Deserialize)]
struct RawPackage {
    name: String,
    full_name: String,
    owner: String,
    package_url: String,
    date_updated: String,
    #[serde(default)]
    rating_score: i64,
    #[serde(default)]
    is_pinned: bool,
    #[serde(default)]
    is_deprecated: bool,
    #[serde(default)]
    has_nsfw_content: bool,
    #[serde(default)]
    categories: Vec<String>,
    versions: RawVersions,
}

/// The newest version, in full.
#[derive(Deserialize)]
struct RawLatest {
    #[serde(default)]
    description: String,
    #[serde(default)]
    icon: String,
    version_number: String,
    #[serde(default)]
    dependencies: Vec<String>,
    #[serde(default)]
    downloads: u64,
    #[serde(default)]
    file_size: u64,
    #[serde(default)]
    website_url: String,
}

/// Older versions: only what we keep. Their (often huge) dependency lists are skipped while
/// parsing, which is most of the 180 MB feed; they're fetched on demand if ever needed.
#[derive(Deserialize)]
struct RawOlder {
    version_number: String,
    #[serde(default)]
    downloads: u64,
}

struct RawVersions {
    latest: Option<RawLatest>,
    older: Vec<RawOlder>,
}

impl<'de> Deserialize<'de> for RawVersions {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> std::result::Result<Self, D::Error> {
        struct V;
        impl<'de> serde::de::Visitor<'de> for V {
            type Value = RawVersions;
            fn expecting(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
                f.write_str("a list of package versions")
            }
            fn visit_seq<A: serde::de::SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<RawVersions, A::Error> {
                let latest = seq.next_element::<RawLatest>()?;
                let mut older = Vec::new();
                while let Some(v) = seq.next_element::<RawOlder>()? {
                    older.push(v);
                }
                Ok(RawVersions { latest, older })
            }
        }
        d.deserialize_seq(V)
    }
}

// ------------------------------------------------------------ slim cached shape

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub url: String,
    pub date_updated: String,
    pub rating: i64,
    pub pinned: bool,
    pub deprecated: bool,
    pub nsfw: bool,
    pub categories: Vec<String>,
    pub total_downloads: u64,
    pub description: String,
    pub icon: String,
    pub website: String,
    /// Version numbers, newest first.
    pub versions: Vec<String>,
    /// Dependencies of the newest version.
    pub dependencies: Vec<String>,
    /// Download size of the newest version.
    pub size: u64,
}

impl Package {
    pub fn latest(&self) -> &str {
        &self.versions[0]
    }

    pub fn has_version(&self, v: &str) -> bool {
        self.versions.iter().any(|x| x == v)
    }

    fn from_raw(r: RawPackage) -> Option<Package> {
        let latest = r.versions.latest?;
        let total = latest.downloads + r.versions.older.iter().map(|v| v.downloads).sum::<u64>();
        let mut versions = Vec::with_capacity(1 + r.versions.older.len());
        versions.push(latest.version_number);
        versions.extend(r.versions.older.into_iter().map(|v| v.version_number));
        Some(Package {
            full_name: r.full_name,
            owner: r.owner,
            name: r.name,
            url: r.package_url,
            date_updated: r.date_updated,
            rating: r.rating_score,
            pinned: r.is_pinned,
            deprecated: r.is_deprecated,
            nsfw: r.has_nsfw_content,
            categories: r.categories,
            total_downloads: total,
            description: latest.description,
            icon: latest.icon,
            website: latest.website_url,
            versions,
            dependencies: latest.dependencies,
            size: latest.file_size,
        })
    }
}

/// What the browse list shows for each package.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageSummary {
    pub full_name: String,
    pub owner: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub latest: String,
    pub total_downloads: u64,
    pub rating: i64,
    pub date_updated: String,
    pub categories: Vec<String>,
    pub deprecated: bool,
    pub nsfw: bool,
    pub pinned: bool,
}

impl From<&Package> for PackageSummary {
    fn from(p: &Package) -> Self {
        PackageSummary {
            full_name: p.full_name.clone(),
            owner: p.owner.clone(),
            name: p.name.clone(),
            description: p.description.clone(),
            icon: p.icon.clone(),
            latest: p.latest().to_string(),
            total_downloads: p.total_downloads,
            rating: p.rating,
            date_updated: p.date_updated.clone(),
            categories: p.categories.clone(),
            deprecated: p.deprecated,
            nsfw: p.nsfw,
            pinned: p.pinned,
        }
    }
}

/// Lowercased text for search, computed once per index instead of on every keystroke.
struct SearchText {
    name: String,
    name_spaced: String,
    owner: String,
    desc: String,
}

pub struct Index {
    pub packages: Vec<Package>,
    pub by_name: HashMap<String, usize>,
    pub fetched_at: String,
    search: Vec<SearchText>,
}

impl Index {
    pub fn new(packages: Vec<Package>, fetched_at: String) -> Index {
        let by_name = packages
            .iter()
            .enumerate()
            .map(|(i, p)| (p.full_name.to_ascii_lowercase(), i))
            .collect();
        let search = packages
            .iter()
            .map(|p| {
                let name = p.name.to_lowercase();
                SearchText {
                    name_spaced: name.replace('_', " "),
                    name,
                    owner: p.owner.to_lowercase(),
                    desc: p.description.to_lowercase(),
                }
            })
            .collect();
        Index { packages, by_name, fetched_at, search }
    }

    pub fn get(&self, full_name: &str) -> Option<&Package> {
        self.by_name
            .get(&full_name.to_ascii_lowercase())
            .map(|&i| &self.packages[i])
    }

    pub fn categories(&self) -> Vec<String> {
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for p in &self.packages {
            for c in &p.categories {
                *counts.entry(c).or_default() += 1;
            }
        }
        counts.into_keys().map(String::from).collect()
    }
}

// ------------------------------------------------------------ versions

/// Lenient "x.y.z" ordering key.
pub fn version_key(v: &str) -> (u64, u64, u64) {
    let mut it = v.split('.').map(|p| {
        p.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u64>()
            .unwrap_or(0)
    });
    (
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
        it.next().unwrap_or(0),
    )
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    version_key(candidate) > version_key(current)
}

/// "Owner-Name-1.2.3" -> ("Owner-Name", "1.2.3")
pub fn split_dependency(dep: &str) -> Option<(String, String)> {
    let (name, ver) = dep.rsplit_once('-')?;
    if !name.contains('-') || ver.is_empty() {
        return None;
    }
    Some((name.to_string(), ver.to_string()))
}

/// A package to install, after walking dependencies.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub full_name: String,
    pub version: String,
    pub dependencies: Vec<String>,
}

/// Work out what to install. The root goes in at the requested version; each dependency
/// goes in at its newest version (Thunderstore dependency versions are minimums, and this is
/// what r2modman does too), unless the profile already has one that's new enough.
/// `root_deps` must be given when the root version isn't the newest (the cache only keeps
/// the newest version's dependency list). Output is ordered dependencies-first.
pub fn resolve(
    index: &Index,
    root: &str,
    root_version: Option<&str>,
    root_deps: Option<&[String]>,
    installed: &HashMap<String, String>,
) -> Result<Vec<Resolved>> {
    let root_pkg = index
        .get(root)
        .ok_or_else(|| AppError::msg(format!("{root} isn't on Thunderstore")))?;
    let root_ver = match root_version {
        Some(v) if !root_pkg.has_version(v) => {
            return Err(AppError::msg(format!("{root} has no version {v}")));
        }
        Some(v) => v.to_string(),
        None => root_pkg.latest().to_string(),
    };
    let root_dependencies = if root_ver == root_pkg.latest() {
        root_pkg.dependencies.clone()
    } else {
        root_deps
            .ok_or_else(|| AppError::msg("Dependencies for that version weren't loaded"))?
            .to_vec()
    };

    let installed_lc: HashMap<String, &String> = installed
        .iter()
        .map(|(k, v)| (k.to_ascii_lowercase(), v))
        .collect();

    let mut chosen: HashMap<String, (usize, Resolved)> = HashMap::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    chosen.insert(
        root_pkg.full_name.clone(),
        (0, Resolved { full_name: root_pkg.full_name.clone(), version: root_ver, dependencies: root_dependencies }),
    );
    queue.push_back((root_pkg.full_name.clone(), 0));
    let mut satisfied: std::collections::HashSet<String> = std::collections::HashSet::new();

    while let Some((name, depth)) = queue.pop_front() {
        if chosen.len() > 2_000 {
            return Err(AppError::msg("Dependency tree is too large"));
        }
        let deps = chosen[&name].1.dependencies.clone();
        for dep in deps {
            let Some((dep_name, min_ver)) = split_dependency(&dep) else { continue };
            let Some(dep_pkg) = index.get(&dep_name) else { continue }; // removed from Thunderstore
            let key = dep_pkg.full_name.clone();
            if let Some(entry) = chosen.get_mut(&key) {
                // seen already: just make sure it installs before everything that needs it
                entry.0 = entry.0.max(depth + 1);
                continue;
            }
            if satisfied.contains(&key) {
                continue;
            }
            if let Some(have) = installed_lc.get(&key.to_ascii_lowercase()) {
                if !is_newer(&min_ver, have) {
                    satisfied.insert(key);
                    continue;
                }
            }
            chosen.insert(
                key.clone(),
                (
                    depth + 1,
                    Resolved {
                        full_name: key.clone(),
                        version: dep_pkg.latest().to_string(),
                        dependencies: dep_pkg.dependencies.clone(),
                    },
                ),
            );
            queue.push_back((key, depth + 1));
        }
    }

    let mut out: Vec<(usize, Resolved)> = chosen.into_values().collect();
    // deepest dependencies first, then by name for a stable order
    out.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.full_name.cmp(&b.1.full_name)));
    Ok(out.into_iter().map(|(_, r)| r).collect())
}

// ------------------------------------------------------------ search

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub category: Option<String>,
    /// downloads | rating | updated | name
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub nsfw: bool,
    #[serde(default)]
    pub deprecated: bool,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    50
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub total: usize,
    pub items: Vec<PackageSummary>,
}

pub fn search(index: &Index, q: &SearchQuery) -> SearchPage {
    let terms: Vec<String> = q
        .text
        .to_lowercase()
        .split_whitespace()
        .map(String::from)
        .collect();
    let mut hits: Vec<(&Package, i32)> = index
        .packages
        .iter()
        .zip(index.search.iter())
        .filter(|(p, _)| q.nsfw || !p.nsfw)
        .filter(|(p, _)| q.deprecated || !p.deprecated)
        .filter(|(p, _)| match &q.category {
            Some(c) if !c.is_empty() => p.categories.iter().any(|x| x == c),
            _ => true,
        })
        .filter_map(|(p, st)| {
            if terms.is_empty() {
                return Some((p, 0));
            }
            let mut score = 0;
            for t in &terms {
                let t = t.as_str();
                if st.name == t {
                    score += 100;
                } else if st.name.starts_with(t) {
                    score += 40;
                } else if st.name.contains(t) || st.name_spaced.contains(t) {
                    score += 25;
                } else if st.owner.contains(t) {
                    score += 10;
                } else if st.desc.contains(t) {
                    score += 5;
                } else {
                    return None; // every term must match somewhere
                }
            }
            Some((p, score))
        })
        .collect();

    let has_text = !terms.is_empty();
    hits.sort_by(|(a, sa), (b, sb)| {
        let primary = match q.sort.as_str() {
            "rating" => b.rating.cmp(&a.rating),
            "updated" => b.date_updated.cmp(&a.date_updated),
            "name" => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            _ => b.total_downloads.cmp(&a.total_downloads),
        };
        // With search text, relevance comes first (pinned packages float when browsing).
        if has_text {
            sb.cmp(sa).then(primary)
        } else {
            b.pinned.cmp(&a.pinned).then(primary)
        }
    });

    let total = hits.len();
    let items = hits
        .into_iter()
        .skip(q.offset)
        .take(q.limit.min(200))
        .map(|(p, _)| PackageSummary::from(p))
        .collect();
    SearchPage { total, items }
}

// ------------------------------------------------------------ fetch + cache

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexMeta {
    etag: Option<String>,
    fetched_at: String,
}

// Bump the file names when the cached shape changes, so an old cache is never misread
// (and the server's "not modified" reply can't keep us on it).
fn index_path() -> PathBuf {
    cache_dir().join("index.v2.json")
}

fn meta_path() -> PathBuf {
    cache_dir().join("index.v2.meta.json")
}

/// Remove caches written by older ModHeim versions (the first one was ~130 MB).
pub fn remove_old_caches() {
    for f in ["index.json", "index.meta.json", "index.raw.tmp"] {
        let _ = std::fs::remove_file(cache_dir().join(f));
    }
}

pub fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .connect_timeout(std::time::Duration::from_secs(20))
        .build()
        .expect("http client")
}

/// Load the slim cached index from disk, if there is one.
pub fn load_cached() -> Option<Index> {
    let bytes = std::fs::read(index_path()).ok()?;
    let packages: Vec<Package> = serde_json::from_slice(&bytes).ok()?;
    let meta: IndexMeta = std::fs::read(meta_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    Some(Index::new(packages, meta.fetched_at))
}

pub fn cache_age_minutes() -> Option<i64> {
    let meta: IndexMeta = serde_json::from_slice(&std::fs::read(meta_path()).ok()?).ok()?;
    let t = chrono::DateTime::parse_from_rfc3339(&meta.fetched_at).ok()?;
    Some((chrono::Utc::now() - t.with_timezone(&chrono::Utc)).num_minutes())
}

/// Download the full index (about 15 MB gzipped, ~180 MB of JSON), slim it down, and cache it.
/// Returns None when the server says our cached copy is still current.
pub async fn fetch_index(
    client: &reqwest::Client,
    on_progress: impl Fn(u64) + Send,
) -> Result<Option<Index>> {
    let meta: IndexMeta = std::fs::read(meta_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default();
    let mut req = client.get(INDEX_URL);
    if let (Some(etag), true) = (&meta.etag, index_path().is_file()) {
        req = req.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    let resp = req.send().await?;
    let now = chrono::Utc::now().to_rfc3339();
    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        write_json_atomic(&meta_path(), &IndexMeta { etag: meta.etag, fetched_at: now })?;
        return Ok(None);
    }
    let resp = resp.error_for_status()?;
    let etag = resp
        .headers()
        .get(reqwest::header::ETAG)
        .and_then(|v| v.to_str().ok())
        .map(String::from);

    // Stream to a temp file so we don't hold the raw body and the parse in memory at once.
    std::fs::create_dir_all(cache_dir())?;
    let raw_path = cache_dir().join("index.raw.tmp");
    {
        let mut file = std::io::BufWriter::new(std::fs::File::create(&raw_path)?);
        let mut stream = resp.bytes_stream();
        let mut got = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            got += chunk.len() as u64;
            file.write_all(&chunk)?;
            on_progress(got);
        }
        file.flush()?;
    }

    let packages = tokio::task::spawn_blocking(move || -> Result<Vec<Package>> {
        let reader = std::io::BufReader::with_capacity(1 << 20, std::fs::File::open(&raw_path)?);
        let raw: Vec<RawPackage> = serde_json::from_reader(reader)?;
        let _ = std::fs::remove_file(&raw_path);
        let slim: Vec<Package> = raw.into_iter().filter_map(Package::from_raw).collect();
        let tmp = index_path().with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec(&slim)?)?;
        std::fs::rename(&tmp, index_path())?;
        Ok(slim)
    })
    .await
    .map_err(|e| AppError::msg(format!("Index parse task failed: {e}")))??;

    write_json_atomic(&meta_path(), &IndexMeta { etag, fetched_at: now.clone() })?;
    Ok(Some(Index::new(packages, now)))
}

pub fn download_url(full_name: &str, version: &str) -> Result<String> {
    let (owner, name) = full_name
        .split_once('-')
        .ok_or_else(|| AppError::msg(format!("Bad package name {full_name}")))?;
    Ok(format!(
        "https://thunderstore.io/package/download/{owner}/{name}/{version}/"
    ))
}

pub fn cached_zip_path(full_name: &str, version: &str) -> PathBuf {
    package_cache_dir().join(format!("{full_name}-{version}.zip"))
}

/// Download a package zip into the cache (or reuse a cached copy).
pub async fn download_package(
    client: &reqwest::Client,
    full_name: &str,
    version: &str,
    on_progress: impl Fn(u64, u64) + Send,
) -> Result<PathBuf> {
    let dest = cached_zip_path(full_name, version);
    if dest.is_file() && zip_is_valid(&dest) {
        return Ok(dest);
    }
    std::fs::create_dir_all(package_cache_dir())?;
    let resp = client
        .get(download_url(full_name, version)?)
        .send()
        .await?
        .error_for_status()?;
    let total = resp.content_length().unwrap_or(0);
    let tmp = dest.with_extension("zip.part");
    {
        let mut file = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        let mut stream = resp.bytes_stream();
        let mut got = 0u64;
        while let Some(chunk) = stream.next().await {
            let chunk = chunk?;
            got += chunk.len() as u64;
            file.write_all(&chunk)?;
            on_progress(got, total);
        }
        file.flush()?;
    }
    if !zip_is_valid(&tmp) {
        let _ = std::fs::remove_file(&tmp);
        return Err(AppError::msg(format!(
            "Download of {full_name} {version} was corrupt. Try again."
        )));
    }
    std::fs::rename(&tmp, &dest)?;
    Ok(dest)
}

fn zip_is_valid(p: &Path) -> bool {
    std::fs::File::open(p)
        .ok()
        .and_then(|f| zip::ZipArchive::new(f).ok())
        .is_some()
}

#[derive(Deserialize)]
struct VersionResp {
    #[serde(default)]
    dependencies: Vec<String>,
}

/// Dependencies of one specific (older) version, straight from Thunderstore.
pub async fn fetch_version_deps(client: &reqwest::Client, full_name: &str, version: &str) -> Result<Vec<String>> {
    let (owner, name) = full_name
        .split_once('-')
        .ok_or_else(|| AppError::msg(format!("Bad package name {full_name}")))?;
    let url = format!("https://thunderstore.io/api/experimental/package/{owner}/{name}/{version}/");
    let r: VersionResp = client.get(url).send().await?.error_for_status()?.json().await?;
    Ok(r.dependencies)
}

#[derive(Deserialize)]
struct ReadmeResp {
    markdown: String,
}

pub async fn fetch_readme(client: &reqwest::Client, full_name: &str, version: &str) -> Result<String> {
    let (owner, name) = full_name
        .split_once('-')
        .ok_or_else(|| AppError::msg(format!("Bad package name {full_name}")))?;
    let url = format!(
        "https://thunderstore.io/api/experimental/package/{owner}/{name}/{version}/readme/"
    );
    let r: ReadmeResp = client.get(url).send().await?.error_for_status()?.json().await?;
    Ok(r.markdown)
}

#[derive(Deserialize)]
struct ChangelogResp {
    markdown: Option<String>,
}

/// The package's CHANGELOG.md as of `version`; None when it doesn't ship one.
pub async fn fetch_changelog(client: &reqwest::Client, full_name: &str, version: &str) -> Result<Option<String>> {
    let (owner, name) = full_name
        .split_once('-')
        .ok_or_else(|| AppError::msg(format!("Bad package name {full_name}")))?;
    let url = format!("https://thunderstore.io/api/experimental/package/{owner}/{name}/{version}/changelog/");
    let resp = client.get(url).send().await?;
    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    let r: ChangelogResp = resp.error_for_status()?.json().await?;
    Ok(r.markdown.filter(|m| !m.trim().is_empty()))
}

/// A version number in a changelog heading ("## Version 2.30.2", "# 1.4.0 (2024-05-01)", "v0.9").
fn heading_version(line: &str) -> Option<String> {
    let t = line.trim_start_matches('#').trim();
    t.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|w| w.contains('.') && w.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())))
        .map(str::to_string)
}

#[derive(Debug, Clone, serde::Serialize, PartialEq)]
pub struct ChangelogSection {
    pub version: String,
    pub markdown: String,
}

/// The changelog sections for versions newer than `from`, up to and including `to`.
/// Empty when the changelog isn't split by version.
pub fn changelog_between(markdown: &str, from: &str, to: &str) -> Vec<ChangelogSection> {
    let (lo, hi) = (version_key(from), version_key(to));
    let mut out: Vec<ChangelogSection> = Vec::new();
    let mut current: Option<ChangelogSection> = None;
    let mut level = 0;
    for line in markdown.lines() {
        let hashes = line.chars().take_while(|&c| c == '#').count();
        if hashes > 0 && (level == 0 || hashes <= level) {
            if let Some(v) = heading_version(line) {
                level = hashes;
                if let Some(c) = current.take() {
                    out.push(c);
                }
                let k = version_key(&v);
                current = (k > lo && k <= hi).then(|| ChangelogSection { version: v, markdown: String::new() });
                continue;
            }
        }
        if let Some(c) = current.as_mut() {
            c.markdown.push_str(line);
            c.markdown.push('\n');
        }
    }
    if let Some(c) = current {
        out.push(c);
    }
    for c in &mut out {
        c.markdown = c.markdown.trim().to_string();
    }
    out
}

#[cfg(test)]
pub mod tests {
    #[test]
    fn changelog_sections_between_versions() {
        let md = "# Changelog

## Version 2.30.2
* fix A

## Version 2.30.1
* add B
### Details
more

## Version 2.30.0
* old
";
        let s = super::changelog_between(md, "2.30.0", "2.30.2");
        assert_eq!(s.iter().map(|c| c.version.as_str()).collect::<Vec<_>>(), ["2.30.2", "2.30.1"]);
        assert_eq!(s[1].markdown, "* add B
### Details
more");
        let s = super::changelog_between("- v1.2.0 (May)
  - thing
# 1.3.0
new", "1.2.0", "1.3.0");
        assert_eq!(s.len(), 1);
        assert!(super::changelog_between("just text", "1.0.0", "2.0.0").is_empty());
    }

    use super::*;

    pub fn pkg(full: &str, versions: &[&str], deps: &[&str]) -> Package {
        let (owner, name) = full.split_once('-').unwrap();
        Package {
            full_name: full.into(),
            owner: owner.into(),
            name: name.into(),
            url: String::new(),
            date_updated: String::new(),
            rating: 0,
            pinned: false,
            deprecated: false,
            nsfw: false,
            categories: vec![],
            total_downloads: 0,
            description: format!("{name} description"),
            icon: String::new(),
            website: String::new(),
            versions: versions.iter().map(|v| v.to_string()).collect(),
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
            size: 0,
        }
    }

    fn sample() -> Index {
        Index::new(
            vec![
                pkg(BEPINEX_PACK, &["5.4.2360", "5.4.2333"], &[]),
                pkg("Lib-Core", &["2.0.0", "1.0.0"], &["denikson-BepInExPack_Valheim-5.4.2360"]),
                pkg("A-ModA", &["1.0.0"], &["Lib-Core-1.0.0", "denikson-BepInExPack_Valheim-5.4.2333"]),
                pkg("B-ModB", &["1.0.0"], &["Lib-Core-2.0.0"]),
                pkg("C-Pack", &["1.0.0"], &["A-ModA-1.0.0", "B-ModB-1.0.0", "Gone-Missing-1.0.0"]),
            ],
            String::new(),
        )
    }

    #[test]
    fn splits_dependency_strings() {
        assert_eq!(
            split_dependency("denikson-BepInExPack_Valheim-5.4.2360"),
            Some(("denikson-BepInExPack_Valheim".into(), "5.4.2360".into()))
        );
        assert_eq!(split_dependency("nonsense"), None);
    }

    #[test]
    fn version_ordering() {
        assert!(is_newer("5.4.2360", "5.4.2333"));
        assert!(is_newer("1.10.0", "1.9.9"));
        assert!(!is_newer("1.0.0", "1.0.0"));
    }

    #[test]
    fn diamond_takes_highest_version_and_orders_deps_first() {
        let idx = sample();
        let r = resolve(&idx, "C-Pack", None, None, &HashMap::new()).unwrap();
        let names: Vec<_> = r.iter().map(|x| format!("{}@{}", x.full_name, x.version)).collect();
        // dependencies install at their newest version
        assert!(names.contains(&"Lib-Core@2.0.0".to_string()));
        assert!(names.contains(&format!("{BEPINEX_PACK}@5.4.2360")));
        assert_eq!(names.last().unwrap(), "C-Pack@1.0.0");
        let pos = |n: &str| names.iter().position(|x| x.starts_with(n)).unwrap();
        assert!(pos(BEPINEX_PACK) < pos("Lib-Core"));
        assert!(pos("Lib-Core") < pos("A-ModA"));
        // missing package skipped, not an error
        assert!(!names.iter().any(|n| n.starts_with("Gone-Missing")));
    }

    #[test]
    fn skips_already_installed_unless_newer_needed() {
        let idx = sample();
        let mut have = HashMap::new();
        have.insert(BEPINEX_PACK.to_string(), "5.4.2360".to_string());
        have.insert("Lib-Core".to_string(), "1.0.0".to_string());
        let r = resolve(&idx, "B-ModB", None, None, &have).unwrap();
        let names: Vec<_> = r.iter().map(|x| x.full_name.as_str()).collect();
        assert_eq!(names, vec!["Lib-Core", "B-ModB"]); // Lib-Core too old for B, BepInEx fine

        // new enough already: nothing but the mod itself
        have.insert("Lib-Core".to_string(), "2.0.0".to_string());
        let r = resolve(&idx, "B-ModB", None, None, &have).unwrap();
        assert_eq!(r.len(), 1);
    }

    #[test]
    fn older_root_version_needs_its_own_deps() {
        let idx = sample();
        assert!(resolve(&idx, "Lib-Core", Some("1.0.0"), None, &HashMap::new()).is_err());
        let r = resolve(&idx, "Lib-Core", Some("1.0.0"), Some(&[]), &HashMap::new()).unwrap();
        assert_eq!(r, vec![Resolved { full_name: "Lib-Core".into(), version: "1.0.0".into(), dependencies: vec![] }]);
    }

    #[test]
    fn parses_raw_feed_keeping_only_latest_deps() {
        let json = r#"[{"name":"M","full_name":"O-M","owner":"O","package_url":"u","date_updated":"d",
            "versions":[{"version_number":"2.0.0","dependencies":["X-Y-1.0.0"],"downloads":5,"file_size":10,"description":"new"},
                        {"version_number":"1.0.0","dependencies":["Huge-List-1.0.0"],"downloads":3,"description":"old"}]}]"#;
        let raw: Vec<RawPackage> = serde_json::from_str(json).unwrap();
        let p = Package::from_raw(raw.into_iter().next().unwrap()).unwrap();
        assert_eq!(p.versions, vec!["2.0.0", "1.0.0"]);
        assert_eq!(p.dependencies, vec!["X-Y-1.0.0"]);
        assert_eq!(p.total_downloads, 8);
        assert_eq!(p.description, "new");
    }

    #[test]
    fn search_ranks_name_matches() {
        let idx = sample();
        let page = search(
            &idx,
            &SearchQuery {
                text: "moda".into(),
                category: None,
                sort: "downloads".into(),
                nsfw: false,
                deprecated: false,
                offset: 0,
                limit: 10,
            },
        );
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].full_name, "A-ModA");
    }
}
