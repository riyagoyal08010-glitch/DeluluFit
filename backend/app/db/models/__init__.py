"""Import all models so Base.metadata is complete (used by Alembic and tests)."""

from app.db.models.consumption import ConsumedItem, MealLog, NutritionEstimate
from app.db.models.foods import Food, FoodAlias, FoodNutrient, FoodServing
from app.db.models.identity import StudentProfile, User, UserAllergy, UserFoodPreference, UserSession
from app.db.models.institutions import Hostel, Institution, Mess
from app.db.models.menus import (MenuDay, MenuExtractionJob, MenuItem, MenuMeal, MenuUpload, MenuVersion,
                                 MessMenu)
from app.db.models.personalization import BudgetTransaction, NutritionTarget, Recommendation, UserBudget

__all__ = [
    "BudgetTransaction", "ConsumedItem", "Food", "FoodAlias", "FoodNutrient", "FoodServing", "Hostel",
    "Institution", "MealLog", "MenuDay", "MenuExtractionJob", "MenuItem", "MenuMeal", "MenuUpload",
    "MenuVersion", "Mess", "MessMenu", "NutritionEstimate", "NutritionTarget", "Recommendation",
    "StudentProfile", "User", "UserAllergy", "UserBudget", "UserFoodPreference", "UserSession",
]
