"""Private object storage for uploaded menu images.

Objects are addressed by server-generated keys only. Nothing here produces a
public URL: images are streamed back through an authenticated API endpoint.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from app.core.config import get_settings

_KEY_RE = re.compile(r"^[a-z0-9/_-]{8,200}$")


class ObjectStorage(Protocol):
    def put(self, key: str, data: bytes, content_type: str) -> None: ...
    def get(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...
    def check(self) -> None: ...


def validate_key(key: str) -> str:
    if not _KEY_RE.match(key) or ".." in key or key.startswith("/"):
        raise ValueError("invalid storage key")
    return key


class LocalStorage:
    """Filesystem storage outside any web root. For development and single-host deployments."""

    def __init__(self, root: Path) -> None:
        self.root = root.resolve()

    def _path(self, key: str) -> Path:
        path = (self.root / validate_key(key)).resolve()
        if self.root not in path.parents:
            raise ValueError("invalid storage key")
        return path

    def put(self, key: str, data: bytes, content_type: str) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".partial")
        tmp.write_bytes(data)
        tmp.replace(path)

    def get(self, key: str) -> bytes:
        return self._path(key).read_bytes()

    def delete(self, key: str) -> None:
        self._path(key).unlink(missing_ok=True)

    def check(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        probe = self.root / ".probe"
        probe.write_bytes(b"ok")
        probe.unlink()


class S3Storage:
    """Private S3-compatible bucket (AWS S3, Cloudflare R2, MinIO...).

    The bucket must block public access; objects are written without ACLs.
    """

    def __init__(self, bucket: str, prefix: str, region: str | None, endpoint_url: str | None) -> None:
        import boto3  # imported lazily so local development does not need AWS config

        self.bucket = bucket
        self.prefix = prefix
        self.client = boto3.client("s3", region_name=region, endpoint_url=endpoint_url)

    def _key(self, key: str) -> str:
        return self.prefix + validate_key(key)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self._key(key), Body=data, ContentType=content_type,
                               ServerSideEncryption="AES256")

    def get(self, key: str) -> bytes:
        obj = self.client.get_object(Bucket=self.bucket, Key=self._key(key))
        body: bytes = obj["Body"].read()
        return body

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(key))

    def check(self) -> None:
        self.client.head_bucket(Bucket=self.bucket)


@lru_cache
def get_storage() -> ObjectStorage:
    settings = get_settings()
    if settings.storage_backend == "s3":
        if not settings.s3_bucket:
            raise RuntimeError("STORAGE_BACKEND=s3 requires S3_BUCKET")
        return S3Storage(settings.s3_bucket, settings.s3_prefix, settings.s3_region, settings.s3_endpoint_url)
    return LocalStorage(settings.local_storage_dir)
