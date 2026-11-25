use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{0}")]
    Msg(String),
    #[error("File error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Network error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("Invalid data: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Invalid profile file: {0}")]
    Yaml(#[from] serde_yaml::Error),
    #[error("Archive error: {0}")]
    Zip(#[from] zip::result::ZipError),
}

impl AppError {
    pub fn msg(s: impl Into<String>) -> Self {
        AppError::Msg(s.into())
    }
}

// Tauri commands return errors to the UI as plain strings.
impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, AppError>;
