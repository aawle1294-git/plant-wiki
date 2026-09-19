import uuid
import logging
from typing import Dict, Any, List
from datetime import datetime, date, timedelta

from app.services.database import get_supabase, user_client
from app.services.memory import MEMORY_WATERING_SCHEDULES, _save_memory

logger = logging.getLogger("plant_wiki.watering")

def ensure_watering_schedule(token: str, user_id: str, plant_name: str, emoji: str = "🌱", interval_days: int = 7) -> Dict[str, Any]:
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("plant_watering_schedules").select("*").eq("user_id", user_id).eq("plant_name", plant_name).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            now_iso = datetime.now().isoformat()
            next_water = (date.today() + timedelta(days=interval_days)).isoformat()
            new_schedule = {
                "user_id": user_id,
                "plant_name": plant_name,
                "emoji": emoji,
                "watering_interval_days": interval_days,
                "last_watered_at": now_iso,
                "next_water_date": next_water,
                "notification_enabled": True,
                "created_at": now_iso,
            }
            ins_res = user_client(token).table("plant_watering_schedules").insert(new_schedule).execute()
            if ins_res.data and len(ins_res.data) > 0:
                return ins_res.data[0]
            return new_schedule
        except Exception as e:
            logger.warning("Supabase watering schedule ensure error: %s", e)
            
    # 인메모리 폴백
    key = f"{user_id}:{plant_name}"
    if key not in MEMORY_WATERING_SCHEDULES:
        now_iso = datetime.now().isoformat()
        next_water = (date.today() + timedelta(days=interval_days)).isoformat()
        MEMORY_WATERING_SCHEDULES[key] = [{
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "plant_name": plant_name,
            "emoji": emoji,
            "watering_interval_days": interval_days,
            "last_watered_at": now_iso,
            "next_water_date": next_water,
            "notification_enabled": True,
            "created_at": now_iso,
        }]
        _save_memory()
    return MEMORY_WATERING_SCHEDULES[key][0]

def get_watering_schedules(token: str, user_id: str) -> List[Dict[str, Any]]:
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("plant_watering_schedules").select("*").eq("user_id", user_id).execute()
            return list(res.data or [])
        except Exception as e:
            logger.warning("Supabase watering schedules fetch error: %s", e)
            
    # 인메모리 폴백
    schedules = []
    for key, items in MEMORY_WATERING_SCHEDULES.items():
        if key.startswith(f"{user_id}:"):
            schedules.extend(items)
    return schedules

def update_watering_schedule(token: str, user_id: str, plant_name: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("plant_watering_schedules").update(updates).eq("user_id", user_id).eq("plant_name", plant_name).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
        except Exception as e:
            logger.warning("Supabase watering schedule update error: %s", e)
            
    # 인메모리 폴백
    key = f"{user_id}:{plant_name}"
    if key in MEMORY_WATERING_SCHEDULES and MEMORY_WATERING_SCHEDULES[key]:
        MEMORY_WATERING_SCHEDULES[key][0].update(updates)
        _save_memory()
        return MEMORY_WATERING_SCHEDULES[key][0]
    return {}

def delete_watering_schedule(token: str, user_id: str, plant_name: str) -> bool:
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("plant_watering_schedules").delete().eq("user_id", user_id).eq("plant_name", plant_name).execute()
            return bool(res.data)
        except Exception as e:
            logger.warning("Supabase watering schedule delete error: %s", e)
            
    # 인메모리 폴백
    key = f"{user_id}:{plant_name}"
    if key in MEMORY_WATERING_SCHEDULES:
        del MEMORY_WATERING_SCHEDULES[key]
        _save_memory()
        return True
    return False

def mark_watered(token: str, user_id: str, plant_name: str) -> Dict[str, Any]:
    schedule = ensure_watering_schedule(token, user_id, plant_name)
    interval = schedule.get("watering_interval_days", 7)
    now_iso = datetime.now().isoformat()
    next_water = (date.today() + timedelta(days=interval)).isoformat()
    updates = {
        "last_watered_at": now_iso,
        "next_water_date": next_water,
    }
    return update_watering_schedule(token, user_id, plant_name, updates)
