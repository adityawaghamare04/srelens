#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Annotations {
    pub read_only: bool,
    pub destructive: bool,
    pub requires_confirm: bool,
}

impl Annotations {
    pub const READ_ONLY: Self =
        Self { read_only: true, destructive: false, requires_confirm: false };
    pub const DESTRUCTIVE: Self =
        Self { read_only: false, destructive: true, requires_confirm: true };
}
