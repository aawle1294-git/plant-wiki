import uuid
import logging
from typing import Dict, Any, List
from datetime import datetime

from app.services.database import get_supabase, user_client
from app.services.memory import MEMORY_HISTORY, _save_memory

logger = logging.getLogger("plant_wiki.history")

def insert_plant_history(token: str, user_id: str, plant_data: Dict[str, Any]):
    bc = plant_data.get("belief_check") or {}
    payload = {
        "user_id": user_id,
        "plant_name": plant_data.get("name", ""),
        "scientific_name": plant_data.get("scientific_name", ""),
        "true_percent": bc.get("true_percent"),
        "false_percent": bc.get("false_percent"),
        "emoji": plant_data.get("emoji", "🌱"),
    }
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            user_client(token).table("plant_history").insert(payload).execute()
            return
        except Exception as e:
            logger.warning("Supabase plant_history insert failed, using memory: %s", e)
    # 인메모리 폴백
    record = {
        "id": str(uuid.uuid4()),
        **payload,
        "created_at": datetime.now().isoformat(),
    }
    MEMORY_HISTORY[user_id].append(record)
    _save_memory()


def get_memory_history(user_id: str) -> List[Dict[str, Any]]:
    """인메모리 히스토리 조회 (최신순)."""
    rows = MEMORY_HISTORY.get(user_id, [])
    return sorted(rows, key=lambda r: r.get("created_at", ""), reverse=True)


def delete_memory_history(user_id: str, row_id: str) -> bool:
    """인메모리 히스토리 삭제."""
    if user_id in MEMORY_HISTORY:
        before = len(MEMORY_HISTORY[user_id])
        MEMORY_HISTORY[user_id] = [r for r in MEMORY_HISTORY[user_id] if r.get("id") != row_id]
        _save_memory()
        return len(MEMORY_HISTORY[user_id]) < before
    return False
