//! Valheim (the game) news and patch notes, from the official Steam announcements feed.

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::settings::{cache_dir, write_json_atomic};
use crate::thunderstore::version_key;

const NEWS_URL: &str = "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=892970&count=30&maxlength=0&feeds=steam_community_announcements&format=json";
const CLAN_IMAGE: &str = "https://clan.akamai.steamstatic.com/images";

#[derive(Deserialize)]
struct Resp {
    appnews: AppNews,
}
#[derive(Deserialize)]
struct AppNews {
    newsitems: Vec<RawItem>,
}
#[derive(Deserialize)]
struct RawItem {
    gid: String,
    title: String,
    url: String,
    #[serde(default)]
    author: String,
    contents: String,
    date: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsItem {
    pub id: String,
    pub title: String,
    pub url: String,
    pub author: String,
    /// Unix seconds
    pub date: i64,
    /// Body converted to Markdown.
    pub body: String,
    pub image: Option<String>,
    /// "1.0.30" when the post is patch notes.
    pub patch: Option<String>,
}

/// "Patch 1.0.30" / "Patch 0.219.14 – Bog Witch" -> "1.0.30"
pub fn patch_version(title: &str) -> Option<String> {
    let rest = title.trim().strip_prefix("Patch")?.trim_start();
    let v: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '.').collect();
    let v = v.trim_end_matches('.').to_string();
    (v.contains('.') && v.chars().next()?.is_ascii_digit()).then_some(v)
}

/// Turn Steam's BBCode into Markdown (the handful of tags announcements actually use).
pub fn bbcode_to_markdown(src: &str) -> String {
    let src = src.replace("{STEAM_CLAN_IMAGE}", CLAN_IMAGE);
    let mut out = String::with_capacity(src.len());
    let mut rest = src.as_str();
    let mut link: Vec<String> = Vec::new();
    while let Some(start) = rest.find('[') {
        out.push_str(&rest[..start]);
        let after = &rest[start..];
        let Some(end) = after.find(']') else {
            out.push_str(after);
            rest = "";
            break;
        };
        let tag = &after[1..end];
        let (name, arg) = match tag.split_once('=') {
            Some((n, a)) => (n.trim().to_ascii_lowercase(), Some(a.trim().trim_matches('"').to_string())),
            None => (tag.trim().to_ascii_lowercase(), None),
        };
        let mut consumed = end + 1;
        match name.as_str() {
            "b" => out.push_str("**"),
            "/b" => {
                // "**Tweaks: **" doesn't render as bold; move trailing spaces outside
                let trimmed = out.trim_end_matches(' ').len();
                let had_space = trimmed < out.len();
                out.truncate(trimmed);
                out.push_str("**");
                if had_space {
                    out.push(' ');
                }
            }
            "i" | "/i" => out.push('*'),
            "u" | "/u" => {}
            "strike" | "/strike" => out.push_str("~~"),
            "h1" => out.push_str("\n\n## "),
            "h2" => out.push_str("\n\n### "),
            "h3" | "h4" | "h5" => out.push_str("\n\n#### "),
            "/h1" | "/h2" | "/h3" | "/h4" | "/h5" => out.push_str("\n\n"),
            "p" => out.push_str("\n\n"),
            "/p" => out.push_str("\n\n"),
            "br" => out.push('\n'),
            "list" | "olist" | "/list" | "/olist" => out.push('\n'),
            "*" => out.push_str("\n* "),
            "/*" => {}
            "hr" | "/hr" => out.push_str("\n\n---\n\n"),
            "quote" => out.push_str("\n> "),
            "/quote" => out.push('\n'),
            "code" | "/code" => out.push('`'),
            "spoiler" | "/spoiler" => {}
            "url" => {
                out.push('[');
                link.push(arg.unwrap_or_default());
            }
            "/url" => {
                let href = link.pop().unwrap_or_default();
                out.push_str(&format!("]({href})"));
            }
            "img" => {
                if let Some(close) = after.to_ascii_lowercase().find("[/img]") {
                    let src = after[end + 1..close].trim();
                    out.push_str(&format!("\n\n![]({src})\n\n"));
                    consumed = close + "[/img]".len();
                }
            }
            "previewyoutube" => {
                if let Some(close) = after.to_ascii_lowercase().find("[/previewyoutube]") {
                    let id = arg.unwrap_or_default();
                    let id = id.split(';').next().unwrap_or("");
                    out.push_str(&format!("\n\n[▶ Watch on YouTube](https://www.youtube.com/watch?v={id})\n\n"));
                    consumed = close + "[/previewyoutube]".len();
                }
            }
            // Not a tag we know: keep the text as-is (it may just be a bracket in prose).
            _ => out.push_str(&after[..end + 1]),
        }
        rest = &after[consumed..];
    }
    out.push_str(rest);
    // tidy runs of blank lines
    let mut tidy = String::with_capacity(out.len());
    let mut blank = 0;
    for line in out.lines() {
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        tidy.push_str(line.trim_end());
        tidy.push('\n');
    }
    tidy.trim().to_string()
}

fn first_image(body: &str) -> Option<String> {
    let i = body.find("![](")?;
    let rest = &body[i + 4..];
    Some(rest[..rest.find(')')?].to_string())
}

fn cache_path() -> std::path::PathBuf {
    cache_dir().join("news.json")
}

pub fn load_cached() -> Vec<NewsItem> {
    std::fs::read(cache_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub async fn fetch(client: &reqwest::Client) -> Result<Vec<NewsItem>> {
    let resp: Resp = client.get(NEWS_URL).send().await?.error_for_status()?.json().await?;
    let items: Vec<NewsItem> = resp
        .appnews
        .newsitems
        .into_iter()
        .map(|r| {
            let body = bbcode_to_markdown(&r.contents);
            NewsItem {
                id: r.gid,
                patch: patch_version(&r.title),
                image: first_image(&body),
                title: r.title,
                url: r.url,
                author: r.author,
                date: r.date,
                body,
            }
        })
        .collect();
    let _ = write_json_atomic(&cache_path(), &items);
    Ok(items)
}

/// Newest patch number in the feed.
pub fn latest_patch(items: &[NewsItem]) -> Option<String> {
    items
        .iter()
        .filter_map(|n| n.patch.clone())
        .max_by_key(|v| version_key(v))
}

/// "1.0.30.0" -> "1.0.30" so it compares with patch titles.
pub fn short_version(v: &str) -> String {
    v.split('.').take(3).collect::<Vec<_>>().join(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_patch_versions() {
        assert_eq!(patch_version("Patch 1.0.30").as_deref(), Some("1.0.30"));
        assert_eq!(patch_version("Patch 0.219.14 - Bog Witch").as_deref(), Some("0.219.14"));
        assert_eq!(patch_version("Vote For Valheim in the Steam Awards!"), None);
        assert_eq!(patch_version("Patch notes are coming"), None);
        assert_eq!(short_version("1.0.30.0"), "1.0.30");
    }

    #[test]
    fn converts_bbcode() {
        let md = bbcode_to_markdown(
            "Intro\n\n[h3]Patch Notes:[/h3]\n\n[b]Tweaks: [/b]\n* One\n[list][*]Two[/list]\n[url=https://x.y]link[/url] [img]{STEAM_CLAN_IMAGE}/1/a.png[/img] [weird] text",
        );
        assert!(md.contains("#### Patch Notes:"));
        assert!(md.contains("**Tweaks:**"));
        assert!(md.contains("* One"));
        assert!(md.contains("* Two"));
        assert!(md.contains("[link](https://x.y)"));
        assert!(md.contains("![](https://clan.akamai.steamstatic.com/images/1/a.png)"));
        assert!(md.contains("[weird] text"));
        assert_eq!(first_image(&md).as_deref(), Some("https://clan.akamai.steamstatic.com/images/1/a.png"));
    }
}
