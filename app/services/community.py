import uuid
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime
from fastapi import HTTPException

from app.services.database import get_supabase, user_client
from app.services.profile import ensure_profile, add_leaf_transaction
from app.services.spam_filter import check_content_safety
from app.services.memory import (
    MEMORY_COMMUNITY_POSTS,
    MEMORY_FRIENDSHIPS,
    MEMORY_COMMUNITY_LIKES,
    MEMORY_COMMUNITY_REPORTS,
    MEMORY_PROFILES,
    _save_memory,
)

logger = logging.getLogger("plant_wiki.community")


def get_user_friend_ids(token: str, user_id: str) -> List[str]:
    """현재 사용자의 친구 ID 목록 반환"""
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            res = (
                user_client(token)
                .table("friendships")
                .select("friend_id")
                .eq("user_id", user_id)
                .execute()
            )
            if res.data:
                return [row["friend_id"] for row in res.data]
        except Exception as e:
            logger.debug("Supabase friendships select error: %s", e)

    return list(MEMORY_FRIENDSHIPS.get(user_id, []))


def get_community_posts(
    token: str, user_id: str, tag: Optional[str] = None, sort_by: str = "latest"
) -> List[Dict[str, Any]]:
    """
    커뮤니티 피드 게시글 목록을 조회합니다.
    - 친구의 글은 최상단에 우선 정렬되며 is_friend=True 플래그가 부여됩니다.
    - 필터: 태그별 필터링
    - 정렬: 최신순(latest), 인기순(popular), 친구글 모아보기(friends)
    """
    friend_ids = set(get_user_friend_ids(token, user_id))
    liked_post_ids = set()

    sb_client = get_supabase()
    posts = []

    if sb_client is not None:
        try:
            # 1. 포스트 조회
            q = user_client(token).table("community_posts").select("*")
            if tag and tag != "전체":
                q = q.eq("tag", tag)
            q = q.order("created_at", desc=True)
            res = q.limit(50).execute()
            if res.data:
                posts = res.data

            # 2. 내 좋아요 목록 조회
            like_res = (
                user_client(token)
                .table("community_likes")
                .select("post_id")
                .eq("user_id", user_id)
                .execute()
            )
            if like_res.data:
                liked_post_ids = {row["post_id"] for row in like_res.data}
        except Exception as e:
            logger.warning("Supabase community_posts fetch error: %s. Using memory.", e)

    # 인메모리 폴백
    if not posts:
        mem_posts = list(MEMORY_COMMUNITY_POSTS)
        if tag and tag != "전체":
            mem_posts = [p for p in mem_posts if p.get("tag") == tag]
        posts = sorted(mem_posts, key=lambda p: p.get("created_at", ""), reverse=True)
        liked_post_ids = set(MEMORY_COMMUNITY_LIKES.get(user_id, []))

    # 기본 데모 글이 아무것도 없으면 감성 식물 피드 2개 생성
    if not posts:
        now_iso = datetime.now().isoformat()
        sample_post = {
            "id": "sample-post-1",
            "user_id": "system-bot",
            "author_email": "bot@plantip.local",
            "author_nickname": "초록이 마스터 🌿",
            "author_avatar": "🪴",
            "author_title": "정원사",
            "content": "오늘 몬스테라 새 잎이 드디어 찢잎으로 예쁘게 돋아났어요! 아침 햇살을 듬뿍 받으니 너무 싱그럽네요. 다들 오늘 물주기 체크하셨나요? 🌱✨",
            "media_url": "https://images.unsplash.com/photo-1614594975525-e45190c55d0b?w=600&auto=format&fit=crop&q=80",
            "media_type": "image",
            "tag": "자랑",
            "likes_count": 7,
            "created_at": now_iso,
        }
        posts = [sample_post]
        MEMORY_COMMUNITY_POSTS.append(sample_post)
        _save_memory()

    # 게시글 데이터 가공
    enriched_posts = []
    for p in posts:
        pid = str(p.get("id"))
        author_id = str(p.get("user_id"))
        is_friend = author_id in friend_ids
        is_mine = author_id == user_id

        # 친구글 모아보기 필터 시 친구가 아니면 제외
        if sort_by == "friends" and not is_friend and not is_mine:
            continue

        item = dict(p)
        item["is_friend"] = is_friend
        item["is_mine"] = is_mine
        item["is_liked"] = pid in liked_post_ids
        enriched_posts.append(item)

    # 정렬 알고리즘:
    # 1. 친구의 글은 어떤 정렬에서든 최상단에 우선 노출 (친구 우선 가중치)
    # 2. 그 다음 정렬 기준 (인기순/최신순)
    if sort_by == "popular":
        enriched_posts.sort(
            key=lambda x: (
                1 if x["is_friend"] else 0,
                x.get("likes_count", 0),
                x.get("created_at", ""),
            ),
            reverse=True,
        )
    else:
        # latest 및 friends
        enriched_posts.sort(
            key=lambda x: (
                1 if x["is_friend"] else 0,
                x.get("created_at", ""),
            ),
            reverse=True,
        )

    return enriched_posts


def create_community_post(
    token: str, user_id: str, email: str, content: str, tag: str = "자유", media_url: Optional[str] = None, media_type: Optional[str] = None
) -> Dict[str, Any]:
    """
    글을 작성하고 AI 실시간 스팸 검사를 통과하면 등록합니다.
    글 작성 성공 시 웰컴 보상으로 +5 리프를 지급합니다.
    """
    # 1. AI 실시간 스팸 & 유해성 검토
    is_safe, reason = check_content_safety(content)
    if not is_safe:
        raise HTTPException(
            status_code=400,
            detail=f"AI 스팸 검토 차단: {reason} (클린한 식물 커뮤니티를 위해 정중한 표현을 부탁드려요! 🌿)",
        )

    # 2. 작성자 프로필 정보 조회
    prof = ensure_profile(token, user_id, email)
    now_iso = datetime.now().isoformat()
    post_id = str(uuid.uuid4())

    new_post = {
        "id": post_id,
        "user_id": user_id,
        "author_email": email,
        "author_nickname": prof.get("nickname") or "새싹 식집사",
        "author_avatar": prof.get("avatar_emoji") or "🌱",
        "author_title": prof.get("title") or "새싹",
        "content": content.strip(),
        "media_url": media_url,
        "media_type": media_type,
        "tag": tag or "자유",
        "likes_count": 0,
        "created_at": now_iso,
        "updated_at": now_iso,
    }

    sb_client = get_supabase()
    saved = False
    if sb_client is not None:
        try:
            ins = user_client(token).table("community_posts").insert(new_post).execute()
            if ins.data:
                saved = True
        except Exception as e:
            logger.warning("Supabase community_posts insert error: %s. Using memory.", e)

    # 인메모리 저장 보장
    MEMORY_COMMUNITY_POSTS.insert(0, new_post)
    _save_memory()

    # 3. 글 작성 리프 보상 지급 (+5 리프)
    try:
        add_leaf_transaction(token, user_id, 5, "community_post_reward")
    except Exception:
        pass

    result = dict(new_post)
    result["is_friend"] = False
    result["is_mine"] = True
    result["is_liked"] = False
    return result


def toggle_post_like(token: str, user_id: str, post_id: str) -> Dict[str, Any]:
    """게시글 좋아요 토글"""
    sb_client = get_supabase()
    liked = False
    new_count = 0

    if sb_client is not None:
        try:
            existing = (
                user_client(token)
                .table("community_likes")
                .select("id")
                .eq("post_id", post_id)
                .eq("user_id", user_id)
                .execute()
            )
            if existing.data and len(existing.data) > 0:
                # 좋아요 취소
                user_client(token).table("community_likes").delete().eq("post_id", post_id).eq("user_id", user_id).execute()
                liked = False
            else:
                # 좋아요 추가
                user_client(token).table("community_likes").insert({"post_id": post_id, "user_id": user_id}).execute()
                liked = True

            # 포스트 likes_count 업데이트
            count_res = user_client(token).table("community_likes").select("id", count="exact").eq("post_id", post_id).execute()
            new_count = count_res.count if count_res.count is not None else 1
            user_client(token).table("community_posts").update({"likes_count": new_count}).eq("id", post_id).execute()
            return {"status": "success", "liked": liked, "likes_count": new_count}
        except Exception as e:
            logger.warning("Supabase like toggle error: %s. Using memory.", e)

    # 인메모리 폴백
    user_likes = MEMORY_COMMUNITY_LIKES[user_id]
    if post_id in user_likes:
        user_likes.remove(post_id)
        liked = False
    else:
        user_likes.append(post_id)
        liked = True

    # 포스트 likes_count 동기화
    for p in MEMORY_COMMUNITY_POSTS:
        if str(p.get("id")) == str(post_id):
            cur = int(p.get("likes_count", 0))
            new_count = max(0, cur + (1 if liked else -1))
            p["likes_count"] = new_count
            break

    _save_memory()
    return {"status": "success", "liked": liked, "likes_count": new_count}


def delete_community_post(token: str, user_id: str, post_id: str) -> bool:
    """본인 작성 게시글 삭제"""
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            user_client(token).table("community_posts").delete().eq("id", post_id).eq("user_id", user_id).execute()
        except Exception as e:
            logger.warning("Supabase delete post error: %s", e)

    # 인메모리 삭제
    global MEMORY_COMMUNITY_POSTS
    for i, p in enumerate(MEMORY_COMMUNITY_POSTS):
        if str(p.get("id")) == str(post_id) and str(p.get("user_id")) == str(user_id):
            del MEMORY_COMMUNITY_POSTS[i]
            break
    _save_memory()
    return True


def get_user_friends(token: str, user_id: str) -> List[Dict[str, Any]]:
    """친구 목록 조회 (상대방 프로필 정보 포함)"""
    friend_ids = get_user_friend_ids(token, user_id)
    friends = []

    sb_client = get_supabase()
    if sb_client is not None and friend_ids:
        try:
            res = user_client(token).table("profiles").select("id, email, nickname, avatar_emoji, title").in_("id", friend_ids).execute()
            if res.data:
                return res.data
        except Exception as e:
            logger.warning("Supabase get friends profiles error: %s", e)

    # 인메모리 폴백
    for fid in friend_ids:
        prof = MEMORY_PROFILES.get(fid)
        if prof:
            friends.append({
                "id": fid,
                "email": prof.get("email", ""),
                "nickname": prof.get("nickname", "식집사"),
                "avatar_emoji": prof.get("avatar_emoji", "🌱"),
                "title": prof.get("title", "새싹"),
            })
        else:
            friends.append({
                "id": fid,
                "email": "friend@plantip.local",
                "nickname": "친한 식집사 🌿",
                "avatar_emoji": "🌱",
                "title": "식물 친구",
            })
    return friends


def add_friend_by_identifier(
    token: str, user_id: str, friend_email: Optional[str] = None, friend_id: Optional[str] = None
) -> Dict[str, Any]:
    """이메일 또는 유저 ID로 친구를 검색하여 친구로 추가합니다."""
    if not friend_email and not friend_id:
        raise HTTPException(status_code=400, detail="친구의 이메일 또는 유저 ID를 입력해 주세요.")

    clean_email = (friend_email or "").strip().lower()
    target_id = (friend_id or "").strip()

    if target_id and target_id == str(user_id):
        raise HTTPException(status_code=400, detail="자기 자신은 친구로 추가할 수 없어요! 🌿")

    # 1. 상대방 찾기
    friend_profile = None
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            if target_id:
                res = user_client(token).table("profiles").select("*").eq("id", target_id).execute()
                if res.data and len(res.data) > 0:
                    friend_profile = res.data[0]
            if not friend_profile and clean_email:
                res = user_client(token).table("profiles").select("*").eq("email", clean_email).execute()
                if res.data and len(res.data) > 0:
                    friend_profile = res.data[0]
        except Exception as e:
            logger.warning("Supabase find friend error: %s", e)

    # 인메모리 폴백 검색
    if not friend_profile:
        if target_id and target_id in MEMORY_PROFILES:
            friend_profile = MEMORY_PROFILES[target_id]
        elif clean_email:
            for p in MEMORY_PROFILES.values():
                if str(p.get("email", "")).lower() == clean_email:
                    friend_profile = p
                    break

    # 피드 포스트 작성자 중 검색 (폴백)
    if not friend_profile and target_id:
        for p in MEMORY_COMMUNITY_POSTS:
            if str(p.get("user_id")) == target_id:
                friend_profile = {
                    "id": target_id,
                    "email": p.get("author_email") or "friend@plantip.local",
                    "nickname": p.get("author_nickname") or "식집사",
                    "avatar_emoji": p.get("author_avatar") or "🌱",
                    "title": p.get("author_title") or "새싹",
                }
                break

    if not friend_profile:
        if clean_email:
            detail_msg = f"'{clean_email}' 계정을 사용하는 식집사를 찾을 수 없습니다. 이메일을 다시 확인해 주세요! 🌱"
        else:
            detail_msg = "해당 식집사를 찾을 수 없습니다."
        raise HTTPException(status_code=404, detail=detail_msg)

    final_friend_id = str(friend_profile["id"])
    if final_friend_id == str(user_id):
        raise HTTPException(status_code=400, detail="자기 자신은 친구로 추가할 수 없어요! 🌿")

    # 2. 친구 관계 등록
    if sb_client is not None:
        try:
            user_client(token).table("friendships").upsert({
                "user_id": user_id,
                "friend_id": final_friend_id,
                "status": "accepted"
            }).execute()
        except Exception as e:
            logger.warning("Supabase add friendship error: %s", e)

    # 인메모리 등록
    if final_friend_id not in MEMORY_FRIENDSHIPS[user_id]:
        MEMORY_FRIENDSHIPS[user_id].append(final_friend_id)
        _save_memory()

    nickname = friend_profile.get("nickname") or "식집사"
    return {
        "status": "success",
        "message": f"'{nickname}'님과 친구가 되었습니다! 🌟 이제 친구의 소식이 피드 최상단에 표시됩니다.",
        "friend": friend_profile,
    }


def add_friend_by_email(token: str, user_id: str, friend_email: str) -> Dict[str, Any]:
    return add_friend_by_identifier(token, user_id, friend_email=friend_email)


def remove_friend(token: str, user_id: str, friend_id: str) -> bool:
    """친구 삭제"""
    sb_client = get_supabase()
    if sb_client is not None:
        try:
            user_client(token).table("friendships").delete().eq("user_id", user_id).eq("friend_id", friend_id).execute()
        except Exception as e:
            logger.warning("Supabase remove friendship error: %s", e)

    if friend_id in MEMORY_FRIENDSHIPS[user_id]:
        MEMORY_FRIENDSHIPS[user_id].remove(friend_id)
        _save_memory()
    return True


def report_community_post(
    token: str, user_id: str, post_id: str, reason: str, details: Optional[str] = None
) -> Dict[str, Any]:
    """
    게시글을 신고합니다.
    - 동일 사용자의 중복 신고 방지
    - Supabase community_reports 저장 및 메모리 보관
    """
    clean_reason = (reason or "").strip()
    if not clean_reason:
        raise HTTPException(status_code=400, detail="신고 사유를 선택해 주세요.")

    clean_details = (details or "").strip()
    now_iso = datetime.now().isoformat()
    report_id = str(uuid.uuid4())

    # 중복 신고 체크 (인메모리)
    for rep in MEMORY_COMMUNITY_REPORTS:
        if str(rep.get("post_id")) == str(post_id) and str(rep.get("reporter_id")) == str(user_id):
            return {
                "status": "success",
                "message": "이미 신고가 접수된 게시글입니다. 빠른 시일 내에 검토하겠습니다.",
                "post_id": post_id,
            }

    report_item = {
        "id": report_id,
        "post_id": post_id,
        "reporter_id": user_id,
        "reason": clean_reason,
        "details": clean_details,
        "status": "pending",
        "created_at": now_iso,
    }

    sb_client = get_supabase()
    if sb_client is not None:
        try:
            user_client(token).table("community_reports").insert(report_item).execute()
        except Exception as e:
            logger.warning("Supabase community_reports insert error: %s. Using memory fallback.", e)

    MEMORY_COMMUNITY_REPORTS.append(report_item)
    _save_memory()

    logger.info("Community post reported: post_id=%s, user_id=%s, reason=%s", post_id, user_id, clean_reason)
    return {
        "status": "success",
        "message": "게시글 신고가 정상 접수되었습니다. 클린한 식물 커뮤니티를 위해 신속히 검토하겠습니다. 🚨",
        "post_id": post_id,
    }
