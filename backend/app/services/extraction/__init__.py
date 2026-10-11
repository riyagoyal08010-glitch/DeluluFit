"""Reading dish names from a menu photo.

The provider returns *candidates*: dish names, meal periods, section headings,
a date and serving notes only where they are printed. It never estimates
nutrition. Every response is validated against `ExtractionResult` before it is
used; anything that doesn't validate is treated as a failed attempt, never as
an empty menu. Image bytes and provider responses are never logged.
"""

from __future__ import annotations

import base64
import json
from datetime import date
from typing import Literal, Protocol

from pydantic import BaseModel, Field, ValidationError, field_validator

from app.core.config import get_settings

MealPeriod = Literal["breakfast", "lunch", "snacks", "dinner", "other"]
MAX_SECTIONS = 12
MAX_ITEMS_PER_SECTION = 40


def _clean(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())[:limit]
    return value or None


class ExtractedItem(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    serving_note: str | None = Field(default=None, max_length=80)
    confidence: float | None = Field(default=None, ge=0, le=1)

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        cleaned = _clean(v, 160)
        if not cleaned:
            raise ValueError("empty dish name")
        return cleaned

    @field_validator("serving_note")
    @classmethod
    def _note(cls, v: str | None) -> str | None:
        return _clean(v, 80)


class ExtractedSection(BaseModel):
    heading: str | None = Field(default=None, max_length=80)
    meal_type: MealPeriod | None = None
    items: list[ExtractedItem] = Field(default_factory=list, max_length=MAX_ITEMS_PER_SECTION)

    @field_validator("heading")
    @classmethod
    def _heading(cls, v: str | None) -> str | None:
        return _clean(v, 80)


class ExtractionResult(BaseModel):
    """Normalized extraction output. Stored on the job; raw provider payloads are not."""

    is_menu: bool
    menu_date: date | None = None
    sections: list[ExtractedSection] = Field(default_factory=list, max_length=MAX_SECTIONS)

    @property
    def item_count(self) -> int:
        return sum(len(s.items) for s in self.sections)


class ExtractionError(Exception):
    """A failed attempt. `retryable` decides whether the job is queued again."""

    def __init__(self, code: str, message: str, *, retryable: bool) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.retryable = retryable


class ExtractionProvider(Protocol):
    name: str
    model: str | None

    def extract(self, image: bytes, content_type: str, *, meal_hint: str | None) -> ExtractionResult: ...


# JSON schema sent to the model (structured output). Kept in step with ExtractionResult.
RESULT_SCHEMA: dict[str, object] = {
    "type": "object",
    "properties": {
        "is_menu": {"type": "boolean"},
        "menu_date": {"type": ["string", "null"], "description": "YYYY-MM-DD, only if a full date is printed"},
        "sections": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "heading": {"type": ["string", "null"]},
                    "meal_type": {"anyOf": [{"type": "string",
                                             "enum": ["breakfast", "lunch", "snacks", "dinner", "other"]},
                                            {"type": "null"}]},
                    "items": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "name": {"type": "string"},
                                "serving_note": {"type": ["string", "null"]},
                                "confidence": {"type": ["number", "null"]},
                            },
                            "required": ["name", "serving_note", "confidence"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["heading", "meal_type", "items"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["is_menu", "menu_date", "sections"],
    "additionalProperties": False,
}

INSTRUCTIONS = """You read photos of hostel and college mess menus in India.
List the dishes exactly as written on the menu. Rules:
- Copy dish names as printed (fix only obvious OCR-style letter errors). Do not translate, rename or add dishes.
- Group dishes under the menu's own section headings. Set meal_type only when the heading or layout clearly
  says breakfast, lunch, snacks or dinner; otherwise null.
- Set menu_date only if a complete date is printed. If the photo covers several days, use the first date
  and include only that day's dishes.
- Set serving_note only when a quantity or serving is printed next to the dish (for example "2 pcs").
- confidence is your confidence (0 to 1) that the dish name is read correctly.
- Never estimate nutrition, ingredients, allergens or prices.
- If the photo is not a menu or nothing is legible, return is_menu false and no sections."""


def parse_result(payload: object) -> ExtractionResult:
    try:
        result = ExtractionResult.model_validate(payload)
    except ValidationError:
        raise ExtractionError("invalid_response", "The menu reader returned data in an unexpected format.",
                              retryable=True) from None
    # Drop empty sections so "nothing read" is represented one way only.
    result.sections = [s for s in result.sections if s.items]
    return result


class AnthropicProvider:
    """Claude vision with structured output. Configured by EXTRACTION_PROVIDER=anthropic and ANTHROPIC_API_KEY."""

    name = "anthropic"

    def __init__(self) -> None:
        import anthropic  # imported lazily: only needed when extraction is enabled

        settings = get_settings()
        self.model = settings.anthropic_model
        self._anthropic = anthropic
        # Retries are bounded by the job (EXTRACTION_MAX_ATTEMPTS), so the SDK doesn't retry on its own.
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key,
                                           timeout=float(settings.extraction_timeout_seconds), max_retries=0)

    def extract(self, image: bytes, content_type: str, *, meal_hint: str | None) -> ExtractionResult:
        a = self._anthropic
        hint = (f"The student says this photo shows the {meal_hint} menu. "
                if meal_hint else "")
        try:
            response = self._client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                # On a safety decline, let the API retry on its recommended fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                output_config={"effort": "medium",
                               "format": {"type": "json_schema", "schema": RESULT_SCHEMA}},
                system=INSTRUCTIONS,
                messages=[{"role": "user", "content": [
                    {"type": "image", "source": {"type": "base64", "media_type": content_type,
                                                 "data": base64.standard_b64encode(image).decode("ascii")}},
                    {"type": "text", "text": hint + "List the dishes on this menu."},
                ]}],
            )
        except a.APITimeoutError:
            raise ExtractionError("provider_timeout", "Reading the photo took too long.", retryable=True) from None
        except (a.RateLimitError, a.InternalServerError, a.APIConnectionError):
            raise ExtractionError("provider_unavailable", "The menu reader is busy or unreachable.",
                                  retryable=True) from None
        except (a.AuthenticationError, a.PermissionDeniedError):
            raise ExtractionError("provider_not_configured", "Photo reading isn't set up correctly on the server.",
                                  retryable=False) from None
        except a.APIStatusError as exc:
            retryable = exc.status_code >= 500
            raise ExtractionError("provider_error", "The menu reader couldn't process this photo.",
                                  retryable=retryable) from None

        if response.stop_reason == "refusal":
            raise ExtractionError("provider_declined", "The menu reader declined to read this photo.",
                                  retryable=False)
        if response.stop_reason == "max_tokens":
            raise ExtractionError("invalid_response", "The menu reader's answer was cut off.", retryable=True)
        text = next((b.text for b in response.content if b.type == "text"), None)
        if text is None:
            raise ExtractionError("invalid_response", "The menu reader returned no result.", retryable=True)
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            raise ExtractionError("invalid_response", "The menu reader returned data in an unexpected format.",
                                  retryable=True) from None
        return parse_result(payload)


def get_provider() -> ExtractionProvider | None:
    """The configured provider, or None when extraction is disabled or has no credentials."""
    settings = get_settings()
    if not settings.extraction_enabled:
        return None
    if settings.extraction_provider == "anthropic":
        return AnthropicProvider()
    return None
