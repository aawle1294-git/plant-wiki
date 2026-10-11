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
    title: Optional[str] = None

class ProfileSyncRequest(BaseModel):
    nickname: Optional[str] = None
    avatar_emoji: Optional[str] = None
    title: Optional[str] = None
    leaf_balance: Optional[int] = None
    streak_count: Optional[int] = None
    last_checkin_date: Optional[str] = None

class BuyItemRequest(BaseModel):
    item_id: str
    price: int
    emoji: Optional[str] = ""
    title: Optional[str] = None
    item_type: Optional[str] = "avatar"

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

class RefreshTokenRequest(BaseModel):
    refresh_token: str

class DeviceSessionRequest(BaseModel):
    device_id: str
    email: Optional[str] = None
    user_id: Optional[str] = None

class SurveySubmitRequest(BaseModel):
    source: Optional[str] = "inline"       # "popup" or "inline"
    reuse: Optional[str] = None            # "yes" | "no"
    speed: Optional[int] = None            # 1~5
    accuracy: Optional[int] = None         # 1~5
    aihelp: Optional[str] = None           # "yes" | "same" | "no"
    differentiators: Optional[list] = None # list of str
    comment: Optional[str] = None
    submitted_at: Optional[str] = None
    email: Optional[str] = None
