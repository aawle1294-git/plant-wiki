from typing import Optional, Dict, Any
from pydantic import BaseModel

class SearchRequest(BaseModel):
    name: str
    force_refresh: bool = False

class AuthRequest(BaseModel):
    email: str
    password: str

class ProfileUpdateRequest(BaseModel):
    nickname: Optional[str] = None
    avatar_emoji: Optional[str] = None

class BuyItemRequest(BaseModel):
    item_id: str
    price: int
    emoji: str

class WateringScheduleCreate(BaseModel):
    plant_name: str
    emoji: Optional[str] = "🌱"
    watering_interval_days: int = 7
    notification_enabled: bool = True

class WateringScheduleUpdate(BaseModel):
    watering_interval_days: Optional[int] = None
    next_water_date: Optional[str] = None
    notification_enabled: Optional[bool] = None
    last_watered_at: Optional[str] = None

class SaveToHistoryRequest(BaseModel):
    name: str
    scientific_name: str = ""
    emoji: str = "🌱"
    true_percent: int = 50
    false_percent: int = 50

