import uuid
import logging
from typing import Dict, Any
from datetime import datetime, date, timedelta, timezone

from app.services.database import get_supabase, user_client
from app.services.memory import MEMORY_PROFILES, MEMORY_LEAF_TX, _save_memory

logger = logging.getLogger("plant_wiki.profile")

def ensure_profile(token: str, user_id: str, email: str = "") -> Dict[str, Any]:
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("profiles").select("*").eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
            now_iso = datetime.now().isoformat()
            new_profile = {
                "id": user_id,
                "email": email,
                "nickname": "새싹 식집사",
                "avatar_emoji": "🌱",
                "leaf_balance": 50,
                "streak_count": 1,
                "last_checkin_date": None,
                "created_at": now_iso,
                "updated_at": now_iso,
            }
            ins_res = user_client(token).table("profiles").insert(new_profile).execute()
            tx = {
                "user_id": user_id,
                "amount": 50,
                "reason": "welcome_bonus",
                "balance_after": 50,
                "created_at": now_iso,
            }
            user_client(token).table("leaf_transactions").insert(tx).execute()
            if ins_res.data and len(ins_res.data) > 0:
                return ins_res.data[0]
            return new_profile
        except Exception as e:
            logger.warning("Supabase profile ensure error: %s", e)
            
    # 인메모리 폴백
    if user_id not in MEMORY_PROFILES:
        now_iso = datetime.now().isoformat()
        MEMORY_PROFILES[user_id] = {
            "id": user_id,
            "email": email or "demo@plantwiki.local",
            "nickname": "새싹 식집사",
            "avatar_emoji": "🌱",
            "leaf_balance": 50,
            "streak_count": 1,
            "last_checkin_date": None,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        MEMORY_LEAF_TX[user_id].append({
            "id": str(uuid.uuid4()),
            "user_id": user_id,
            "amount": 50,
            "reason": "welcome_bonus",
            "balance_after": 50,
            "created_at": now_iso,
        })
        _save_memory()
    return MEMORY_PROFILES[user_id]


def update_profile(token: str, user_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    updates["updated_at"] = datetime.now().isoformat()
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("profiles").update(updates).eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                return res.data[0]
        except Exception as e:
            logger.warning("Supabase profile update error: %s", e)
    # 인메모리 폴백
    prof = ensure_profile(token, user_id)
    prof.update(updates)
    _save_memory()
    return prof


def add_leaf_transaction(token: str, user_id: str, amount: int, reason: str) -> int:
    prof = ensure_profile(token, user_id)
    cur_bal = int(prof.get("leaf_balance", 0))
    new_bal = max(0, cur_bal + amount)
    now_iso = datetime.now().isoformat()
    update_profile(token, user_id, {"leaf_balance": new_bal})

    tx_payload = {
        "user_id": user_id,
        "amount": amount,
        "reason": reason,
        "balance_after": new_bal,
        "created_at": now_iso,
    }
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            user_client(token).table("leaf_transactions").insert(tx_payload).execute()
        except Exception as e:
            logger.warning("Supabase leaf_transaction insert error: %s", e)
    else:
        tx_payload["id"] = str(uuid.uuid4())
        MEMORY_LEAF_TX[user_id].append(tx_payload)
        _save_memory()
    return new_bal


def do_streak_checkin(token: str, user_id: str) -> Dict[str, Any]:
    prof = ensure_profile(token, user_id)
    kst = timezone(timedelta(hours=9))
    today = datetime.now(kst).date()
    today_str = today.isoformat()
    last_date_str = prof.get("last_checkin_date")

    if last_date_str == today_str:
        return {
            "status": "already_checked_in",
            "message": "오늘 이미 출석 체크를 완료했어요! 내일 또 만나요 🌱",
            "reward": 0,
            "streak": prof.get("streak_count", 1),
            "profile": prof,
        }

    yesterday_str = (today - timedelta(days=1)).isoformat()
    current_streak = int(prof.get("streak_count") or 0)
    if last_date_str == yesterday_str:
        new_streak = current_streak + 1
    else:
        new_streak = 1

    reward = 10
    new_balance = add_leaf_transaction(token, user_id, reward, "daily_checkin")
    updated_prof = update_profile(token, user_id, {
        "last_checkin_date": today_str,
        "streak_count": new_streak,
        "leaf_balance": new_balance,
    })

    return {
        "status": "success",
        "message": f"출석 완료! +{reward} 리프 획득 🍃 (연속 {new_streak}일차 달성!)",
        "reward": reward,
        "streak": new_streak,
        "profile": updated_prof,
    }
