"""Validate and normalize uploaded menu photos.

The file's real content decides whether it is accepted: the name and the
client's Content-Type are ignored. Accepted images are decoded, rotated
upright, downscaled and re-encoded as JPEG, so no metadata from the original
file (EXIF, GPS location, camera details, ICC profiles, comments) is stored,
and nothing executable can ride along inside the stored bytes.
"""

from __future__ import annotations

import hashlib
import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps, UnidentifiedImageError

from app.core.config import get_settings
from app.core.errors import ValidationFailedError

ALLOWED_FORMATS = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}
STORED_CONTENT_TYPE = "image/jpeg"


@dataclass(frozen=True)
class NormalizedImage:
    data: bytes
    content_type: str
    width: int
    height: int
    # SHA-256 of the bytes the student uploaded, used to spot the same photo uploaded twice.
    original_sha256: str


def _reject(message: str, code: str) -> ValidationFailedError:
    return ValidationFailedError(message, code=code)


def normalize(raw: bytes) -> NormalizedImage:
    settings = get_settings()
    if not raw:
        raise _reject("The file is empty.", "upload_empty")
    if len(raw) > settings.max_upload_bytes:
        raise _reject(f"The photo is larger than {settings.max_upload_bytes // (1024 * 1024)} MB.", "upload_too_large")

    # Decompression-bomb guard: refuse anything above the configured pixel count.
    Image.MAX_IMAGE_PIXELS = settings.max_image_pixels
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as probe:
                fmt = probe.format
                if fmt not in ALLOWED_FORMATS:
                    raise _reject("Use a JPEG, PNG or WebP photo.", "unsupported_image_type")
                if probe.width * probe.height > settings.max_image_pixels:
                    raise _reject("The photo has too many pixels. Use a smaller photo.", "image_too_large")
                probe.verify()  # structural check; the image must be reopened afterwards
            with Image.open(io.BytesIO(raw)) as img:
                img.load()
                upright = ImageOps.exif_transpose(img)
                if getattr(upright, "n_frames", 1) > 1:
                    upright.seek(0)
                if upright.mode in ("RGBA", "LA", "P"):
                    rgba = upright.convert("RGBA")
                    background = Image.new("RGB", rgba.size, (255, 255, 255))
                    background.paste(rgba, mask=rgba.getchannel("A"))
                    rgb = background
                else:
                    rgb = upright.convert("RGB")
    except ValidationFailedError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise _reject("The photo has too many pixels. Use a smaller photo.", "image_too_large") from None
    except (UnidentifiedImageError, OSError, SyntaxError, ValueError):
        raise _reject("This file isn't a readable JPEG, PNG or WebP image.", "invalid_image") from None

    rgb.thumbnail((settings.normalized_image_max_side, settings.normalized_image_max_side))
    out = io.BytesIO()
    # No exif/icc_profile arguments: the stored file carries no metadata.
    rgb.save(out, format="JPEG", quality=85, optimize=True)
    return NormalizedImage(data=out.getvalue(), content_type=STORED_CONTENT_TYPE, width=rgb.width,
                           height=rgb.height, original_sha256=hashlib.sha256(raw).hexdigest())
