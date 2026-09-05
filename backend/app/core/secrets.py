from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import SECRET_KEY_PATH


def get_fernet() -> Fernet:
    """Load the Fernet key from disk, creating it on first use (we own the file
    in the data dir; os.chmod 0600 where the platform supports it)."""
    if not SECRET_KEY_PATH.exists():
        key = Fernet.generate_key()
        SECRET_KEY_PATH.parent.mkdir(parents=True, exist_ok=True)
        SECRET_KEY_PATH.write_bytes(key)
        try:
            os.chmod(SECRET_KEY_PATH, 0o600)
        except OSError:
            pass
    return Fernet(SECRET_KEY_PATH.read_bytes())


def encrypt_secret(plaintext: str) -> bytes:
    return get_fernet().encrypt(plaintext.encode("utf-8"))


def decrypt_secret(cipher: bytes) -> str:
    return get_fernet().decrypt(cipher).decode("utf-8")


def try_decrypt_secret(cipher: bytes) -> str | None:
    """Return the plaintext, or None if the key changed / blob is unreadable."""
    try:
        return decrypt_secret(cipher)
    except InvalidToken:
        return None