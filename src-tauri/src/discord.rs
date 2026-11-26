//! "Playing Valheim with 22 mods" in Discord, through Discord's local IPC pipe (the documented
//! RPC handshake + SET_ACTIVITY). Needs the user's own Discord Application ID; the activity
//! shows under that application's name. Everything here is best-effort: if Discord isn't
//! running, nothing happens.

use std::io::{Read, Write};
use std::sync::Mutex;

use serde_json::json;

struct Conn {
    pipe: std::fs::File,
    app_id: String,
}

static CONN: Mutex<Option<Conn>> = Mutex::new(None);

fn frame(op: u32, payload: &serde_json::Value) -> Vec<u8> {
    let body = payload.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + body.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(body.len() as u32).to_le_bytes());
    out.extend_from_slice(&body);
    out
}

fn read_frame(pipe: &mut std::fs::File) -> std::io::Result<(u32, serde_json::Value)> {
    let mut head = [0u8; 8];
    pipe.read_exact(&mut head)?;
    let op = u32::from_le_bytes(head[0..4].try_into().unwrap());
    let len = u32::from_le_bytes(head[4..8].try_into().unwrap()) as usize;
    if len > 1 << 20 {
        return Err(std::io::Error::other("frame too large"));
    }
    let mut body = vec![0u8; len];
    pipe.read_exact(&mut body)?;
    Ok((op, serde_json::from_slice(&body).unwrap_or_default()))
}

fn connect(app_id: &str) -> Option<Conn> {
    for i in 0..10 {
        let path = format!(r"\\.\pipe\discord-ipc-{i}");
        let Ok(mut pipe) = std::fs::OpenOptions::new().read(true).write(true).open(&path) else { continue };
        if pipe.write_all(&frame(0, &json!({ "v": 1, "client_id": app_id }))).is_err() {
            continue;
        }
        // READY, or an error for a bad application id
        match read_frame(&mut pipe) {
            Ok((_, v)) if v["evt"] == "READY" => return Some(Conn { pipe, app_id: app_id.to_string() }),
            _ => continue,
        }
    }
    None
}

fn send(app_id: &str, activity: serde_json::Value) {
    let mut guard = CONN.lock().unwrap();
    if guard.as_ref().is_some_and(|c| c.app_id != app_id) {
        *guard = None;
    }
    for _ in 0..2 {
        if guard.is_none() {
            *guard = connect(app_id);
        }
        let Some(c) = guard.as_mut() else { return };
        let msg = json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity },
            "nonce": format!("{}", chrono::Utc::now().timestamp_nanos_opt().unwrap_or(0)),
        });
        if c.pipe.write_all(&frame(1, &msg)).is_ok() && read_frame(&mut c.pipe).is_ok() {
            return;
        }
        // Discord restarted: reconnect once
        *guard = None;
    }
}

/// Show the session in Discord. Runs on its own thread; never blocks the caller.
pub fn playing(app_id: String, profile: Option<String>, mods: usize, start: i64) {
    std::thread::spawn(move || {
        let (details, state) = match profile {
            Some(p) => (format!("Modded · {p}"), format!("{mods} mod{}", if mods == 1 { "" } else { "s" })),
            None => ("Vanilla".to_string(), "No mods".to_string()),
        };
        send(&app_id, json!({ "details": details, "state": state, "timestamps": { "start": start } }));
    });
}

/// Clear the activity (the game closed).
pub fn clear(app_id: String) {
    std::thread::spawn(move || send(&app_id, serde_json::Value::Null));
}

/// Is this a plausible Discord application id (a snowflake)?
pub fn valid_app_id(id: &str) -> bool {
    (15..=21).contains(&id.len()) && id.chars().all(|c| c.is_ascii_digit())
}

#[cfg(test)]
mod tests {
    #[test]
    fn frames_and_ids() {
        let f = super::frame(1, &serde_json::json!({"a": 1}));
        assert_eq!(&f[0..4], &1u32.to_le_bytes());
        assert_eq!(&f[4..8], &7u32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
        assert!(super::valid_app_id("1234567890123456789"));
        assert!(!super::valid_app_id("abc"));
        assert!(!super::valid_app_id("12"));
    }
}
