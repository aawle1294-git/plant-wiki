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
                prof = res.data[0]
                if prof.get("owned_items") is None:
                    prof["owned_items"] = []
                return prof
            now_iso = datetime.now().isoformat()
            new_profile = {
                "id": user_id,
                "email": email,
                "nickname": "새싹 식집사",
                "avatar_emoji": "🌱",
                "title": "새싹",
                "leaf_balance": 50,
                "streak_count": 1,
                "last_checkin_date": None,
                "owned_items": [],
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
                prof = ins_res.data[0]
                if prof.get("owned_items") is None:
                    prof["owned_items"] = []
                return prof
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
            "title": "새싹",
            "leaf_balance": 50,
            "streak_count": 1,
            "last_checkin_date": None,
            "owned_items": [],
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
    prof = MEMORY_PROFILES[user_id]
    if prof.get("owned_items") is None:
        prof["owned_items"] = []
    return prof


def update_profile(token: str, user_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    updates["updated_at"] = datetime.now().isoformat()
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = user_client(token).table("profiles").update(updates).eq("id", user_id).execute()
            if res.data and len(res.data) > 0:
                prof = res.data[0]
                if prof.get("owned_items") is None:
                    prof["owned_items"] = []
                return prof
        except Exception as e:
            logger.warning("Supabase profile update error: %s", e)
    # 인메모리 폴백
    prof = ensure_profile(token, user_id)
    prof.update(updates)
    _save_memory()
    return prof


def sync_profile(token: str, user_id: str, client_data: Dict[str, Any]) -> Dict[str, Any]:
    """클라이언트(localStorage)와 서버 데이터를 안전하게 병합하여 데이터 초기화 및 유실을 원천 차단"""
    prof = ensure_profile(token, user_id)
    updates = {}
    
    # 1. 리프 잔액: 둘 중 더 큰 값 보존
    client_leaves = client_data.get("leaf_balance")
    if client_leaves is not None:
        try:
            cl_int = int(client_leaves)
            cur_bal = int(prof.get("leaf_balance") or 0)
            if cl_int > cur_bal:
                updates["leaf_balance"] = cl_int
        except Exception:
            pass

    # 2. 연속 출석일: 둘 중 더 큰 값 보존
    client_streak = client_data.get("streak_count")
    if client_streak is not None:
        try:
            cs_int = int(client_streak)
            cur_st = int(prof.get("streak_count") or 1)
            if cs_int > cur_st:
                updates["streak_count"] = cs_int
        except Exception:
            pass

    # 3. 닉네임: 사용자가 설정한 값 보존
    client_nick = client_data.get("nickname")
    if client_nick and str(client_nick).strip() and client_nick != "새싹 식집사":
        updates["nickname"] = str(client_nick).strip()

    # 4. 아바타: 사용자가 변경한 이모지 보존
    client_avatar = client_data.get("avatar_emoji")
    if client_avatar and str(client_avatar).strip() and client_avatar != "🌱":
        updates["avatar_emoji"] = str(client_avatar).strip()

    # 5. 칭호: 획득한 칭호 보존
    client_title = client_data.get("title")
    if client_title and str(client_title).strip() and client_title != "새싹":
        updates["title"] = str(client_title).strip()

    # 6. 최근 출석일 보존
    client_checkin = client_data.get("last_checkin_date")
    if client_checkin and not prof.get("last_checkin_date"):
        updates["last_checkin_date"] = client_checkin

    # 7. 소유 아이템 목록 (상점 구매 내역) 안전하게 병합
    client_owned = client_data.get("owned_items")
    if client_owned and isinstance(client_owned, list):
        cur_owned = prof.get("owned_items") or []
        if isinstance(cur_owned, str):
            try:
                import json
                cur_owned = json.loads(cur_owned)
            except Exception:
                cur_owned = []
        merged_owned = list(dict.fromkeys(cur_owned + [str(x) for x in client_owned]))
        if len(merged_owned) > len(cur_owned):
            updates["owned_items"] = merged_owned

    if updates:
        prof = update_profile(token, user_id, updates)
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
