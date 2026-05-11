use thiserror::Error;

pub type Result<T> = std::result::Result<T, MpcKitError>;

/// Backend error envelope. Returned for any non-2xx response. We
/// preserve `code` and the raw body so callers can branch on
/// `INSUFFICIENT_CREDITS`, `RATE_LIMITED`, etc., without re-parsing.
#[derive(Debug, Error)]
pub enum MpcKitError {
    #[error("HTTP error {status} ({code}): {message}")]
    Http {
        status: u16,
        code: String,
        message: String,
        body: serde_json::Value,
    },

    #[error("insufficient credits: {message}")]
    InsufficientCredits {
        message: String,
        body: serde_json::Value,
    },

    #[error("request timed out: {0}")]
    Timeout(String),

    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),

    #[error("malformed url: {0}")]
    Url(#[from] url::ParseError),

    #[error("could not (de)serialise body: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("invalid argument: {0}")]
    Invalid(String),

    /// Native crypto failure from the centralized-party / inkrypto
    /// stack. Only emitted by the `crypto` feature module.
    #[error("crypto error: {0}")]
    Crypto(String),
}

impl MpcKitError {
    pub fn code(&self) -> Option<&str> {
        match self {
            Self::Http { code, .. } => Some(code),
            Self::InsufficientCredits { .. } => Some("INSUFFICIENT_CREDITS"),
            _ => None,
        }
    }

    pub fn http_status(&self) -> Option<u16> {
        match self {
            Self::Http { status, .. } => Some(*status),
            Self::InsufficientCredits { .. } => Some(402),
            _ => None,
        }
    }
}
