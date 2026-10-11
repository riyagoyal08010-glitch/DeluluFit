"""Allowed values for text columns guarded by CHECK constraints.

Kept as plain tuples so the same source of truth feeds the database
constraints, Pydantic `Literal` types and tests.
"""

USER_ROLES = ("student", "admin")
ACTIVITY_LEVELS = ("sedentary", "light", "moderate", "active", "very_active")
DIETARY_PATTERNS = ("vegetarian", "eggetarian", "non_vegetarian", "vegan", "jain", "no_preference")
PREFERENCE_KINDS = ("like", "dislike", "avoid")
ALLERGENS = ("peanut", "tree_nut", "milk", "egg", "wheat_gluten", "soy", "fish", "shellfish",
             "sesame", "mustard", "other")
ALLERGY_SEVERITIES = ("mild", "moderate", "severe", "unknown")
UPLOAD_CONTENT_TYPES = ("image/jpeg", "image/png", "image/webp")
EXTRACTION_STATUSES = ("queued", "processing", "succeeded", "failed")
MENU_VERSION_STATUSES = ("draft", "confirmed")
MENU_VERSION_SOURCES = ("extraction", "manual", "revision")
MENU_ITEM_SOURCES = ("extraction", "manual")
MEAL_TYPES = ("breakfast", "lunch", "snacks", "dinner", "other")
CONFIDENCE_LEVELS = ("HIGH", "MEDIUM", "LOW", "UNKNOWN")
DIET_TYPES = ("vegan", "vegetarian", "eggetarian", "non_vegetarian", "unknown")
MEAL_LOG_SOURCES = ("mess_menu", "outside", "manual")
CONSUMED_UNITS = ("g", "ml", "serving")
MASS_SOURCES = ("user_grams", "serving_reference", "unknown")
ESTIMATE_METHODS = ("per_reference_mass", "unavailable")
BUDGET_PERIODS = ("daily", "weekly", "monthly")
TRANSACTION_KINDS = ("expense", "refund")
SPENDING_CATEGORIES = ("mess", "outside_food", "groceries", "beverages", "snacks", "other")
TARGET_SOURCES = ("reference_estimate", "self_set", "professional")
RECOMMENDATION_KINDS = ("menu_option", "log_reminder", "data_gap", "budget", "spending_summary")
