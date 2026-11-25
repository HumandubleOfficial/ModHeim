//! Server status through the Steam A2S_INFO query, which Valheim dedicated servers answer
//! on their query port (game port + 1). Servers reached only through a crossplay join code
//! don't answer this; they show as "unknown" rather than offline.

use std::time::{Duration, Instant};

use serde::Serialize;
use tokio::net::UdpSocket;

const A2S_INFO: &[u8] = b"\xFF\xFF\xFF\xFFTSource Engine Query\0";

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ServerStatus {
    pub id: String,
    /// online | offline | unknown
    pub state: String,
    pub name: Option<String>,
    pub players: Option<u8>,
    pub max_players: Option<u8>,
    pub ping_ms: Option<u32>,
    /// Game version the server advertises, when it does.
    pub version: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, PartialEq)]
pub struct Info {
    pub name: String,
    pub players: u8,
    pub max_players: u8,
    pub keywords: Option<String>,
}

enum Reply {
    Challenge([u8; 4]),
    Info(Info),
}

struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl Reader<'_> {
    fn u8(&mut self) -> Option<u8> {
        let v = *self.b.get(self.i)?;
        self.i += 1;
        Some(v)
    }
    fn skip(&mut self, n: usize) -> Option<()> {
        (self.i + n <= self.b.len()).then(|| self.i += n)
    }
    fn cstr(&mut self) -> Option<String> {
        let rest = &self.b[self.i..];
        let end = rest.iter().position(|&c| c == 0)?;
        self.i += end + 1;
        Some(String::from_utf8_lossy(&rest[..end]).to_string())
    }
}

fn parse_reply(b: &[u8]) -> Option<Reply> {
    if b.len() < 5 || b[..4] != [0xFF; 4] {
        return None;
    }
    match b[4] {
        0x41 if b.len() >= 9 => Some(Reply::Challenge([b[5], b[6], b[7], b[8]])),
        0x49 => {
            let mut r = Reader { b, i: 5 };
            r.u8()?; // protocol
            let name = r.cstr()?;
            r.cstr()?; // map
            r.cstr()?; // folder
            r.cstr()?; // game
            r.skip(2)?; // app id
            let players = r.u8()?;
            let max_players = r.u8()?;
            r.skip(5)?; // bots, type, environment, visibility, vac
            r.cstr()?; // version
            let mut keywords = None;
            if let Some(edf) = r.u8() {
                if edf & 0x80 != 0 {
                    r.skip(2)?;
                }
                if edf & 0x10 != 0 {
                    r.skip(8)?;
                }
                if edf & 0x40 != 0 {
                    r.skip(2)?;
                    r.cstr()?;
                }
                if edf & 0x20 != 0 {
                    keywords = r.cstr();
                }
            }
            Some(Reply::Info(Info { name, players, max_players, keywords }))
        }
        _ => None,
    }
}

/// Pull a game version ("0.221.4" / "1.0.30") out of the server's keywords, if it lists one.
pub fn version_from_keywords(k: &str) -> Option<String> {
    k.split(|c: char| !(c.is_ascii_digit() || c == '.'))
        .find(|t| t.matches('.').count() >= 2 && t.chars().next().is_some_and(|c| c.is_ascii_digit()))
        .map(|t| t.trim_end_matches('.').to_string())
}

/// "host:port" of the game -> query socket address (port + 1).
async fn query_addr(address: &str) -> Result<std::net::SocketAddr, String> {
    let (host, port) = address.trim().rsplit_once(':').ok_or("Address needs a port, like host:2456")?;
    let port: u16 = port.parse().map_err(|_| "That port isn't a number")?;
    let mut addrs = tokio::net::lookup_host((host, port.saturating_add(1)))
        .await
        .map_err(|_| format!("Couldn't find {host}"))?;
    addrs.next().ok_or_else(|| format!("Couldn't find {host}"))
}

pub async fn query(id: &str, address: &str) -> ServerStatus {
    let mut status = ServerStatus { id: id.to_string(), state: "unknown".into(), ..Default::default() };
    let addr = match query_addr(address).await {
        Ok(a) => a,
        Err(e) => {
            status.error = Some(e);
            return status;
        }
    };
    let result: Result<(Info, u32), String> = async {
        let bind = if addr.is_ipv6() { "[::]:0" } else { "0.0.0.0:0" };
        let sock = UdpSocket::bind(bind).await.map_err(|e| e.to_string())?;
        sock.connect(addr).await.map_err(|e| e.to_string())?;
        let mut request = A2S_INFO.to_vec();
        let mut buf = [0u8; 1400];
        for _ in 0..3 {
            let started = Instant::now();
            sock.send(&request).await.map_err(|e| e.to_string())?;
            let n = tokio::time::timeout(Duration::from_millis(1500), sock.recv(&mut buf))
                .await
                .map_err(|_| "No answer".to_string())?
                .map_err(|e| e.to_string())?;
            let ping = started.elapsed().as_millis() as u32;
            match parse_reply(&buf[..n]) {
                Some(Reply::Info(info)) => return Ok((info, ping)),
                Some(Reply::Challenge(c)) => {
                    request = A2S_INFO.to_vec();
                    request.extend_from_slice(&c);
                }
                None => return Err("Unexpected answer".into()),
            }
        }
        Err("No answer".into())
    }
    .await;
    match result {
        Ok((info, ping)) => {
            status.state = "online".into();
            status.version = info.keywords.as_deref().and_then(version_from_keywords);
            status.name = Some(info.name);
            status.players = Some(info.players);
            status.max_players = Some(info.max_players);
            status.ping_ms = Some(ping);
        }
        Err(e) => {
            // No reply could mean offline, or a crossplay-only server that doesn't answer queries.
            status.state = "offline".into();
            status.error = Some(e);
        }
    }
    status
}

#[cfg(test)]
mod tests {
    use super::*;

    fn info_packet() -> Vec<u8> {
        let mut p = vec![0xFF, 0xFF, 0xFF, 0xFF, 0x49, 17];
        for s in ["Dad's World", "", "valheim", "Valheim"] {
            p.extend_from_slice(s.as_bytes());
            p.push(0);
        }
        p.extend_from_slice(&[0x9A, 0x9C]); // app id
        p.extend_from_slice(&[3, 10, 0, b'd', b'w', 0, 0]); // players, max, bots, type, env, vis, vac
        p.extend_from_slice(b"1.0.0.0\0");
        p.push(0x80 | 0x20); // EDF: port + keywords
        p.extend_from_slice(&[0x98, 0x09]);
        p.extend_from_slice(b"1.0.30,crossplay\0");
        p
    }

    #[test]
    fn parses_info_reply() {
        match parse_reply(&info_packet()) {
            Some(Reply::Info(i)) => {
                assert_eq!(i.name, "Dad's World");
                assert_eq!((i.players, i.max_players), (3, 10));
                assert_eq!(i.keywords.as_deref(), Some("1.0.30,crossplay"));
                assert_eq!(version_from_keywords(i.keywords.as_deref().unwrap()).as_deref(), Some("1.0.30"));
            }
            _ => panic!("expected info"),
        }
    }

    #[test]
    fn parses_challenge_and_rejects_junk() {
        assert!(matches!(parse_reply(&[0xFF, 0xFF, 0xFF, 0xFF, 0x41, 1, 2, 3, 4]), Some(Reply::Challenge([1, 2, 3, 4]))));
        assert!(parse_reply(b"hello").is_none());
        assert!(parse_reply(&[0xFF, 0xFF, 0xFF, 0xFF, 0x49, 17, b'x']).is_none()); // truncated
    }

    #[tokio::test]
    async fn queries_a_local_fake_server() {
        let server = UdpSocket::bind("127.0.0.1:0").await.unwrap();
        let port = server.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut buf = [0u8; 256];
            // first: hand out a challenge, then answer the retried request
            let (_, from) = server.recv_from(&mut buf).await.unwrap();
            server.send_to(&[0xFF, 0xFF, 0xFF, 0xFF, 0x41, 9, 9, 9, 9], from).await.unwrap();
            let (n, from) = server.recv_from(&mut buf).await.unwrap();
            assert_eq!(&buf[n - 4..n], &[9, 9, 9, 9]);
            server.send_to(&info_packet(), from).await.unwrap();
        });
        let s = query("x", &format!("127.0.0.1:{}", port - 1)).await;
        assert_eq!(s.state, "online");
        assert_eq!(s.players, Some(3));
        assert_eq!(s.version.as_deref(), Some("1.0.30"));
    }
}
