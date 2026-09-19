from typing import Dict, Any
from fastapi import Request, HTTPException
from app.services.database import get_supabase

def get_current_user_or_fallback(request: Request) -> Dict[str, Any]:
    import os
    DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
    
    auth = request.headers.get("Authorization", "")
    sb_client = get_supabase()
    
    if sb_client is not None and not DEV_MODE:
        if not auth.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        token = auth[len("Bearer "):].strip()
        if not token:
            raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        try:
            res = sb_client.auth.get_user(token)
        except Exception:
            raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")
        if not res or not res.user:
            raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")
        return {"id": res.user.id, "email": res.user.email or "", "token": token}
        
    # Supabase 미설정시 또는 DEV_MODE일때 인메모리 데모 유저
    return {"id": "demo-user", "email": "demo@plantwiki.local", "token": "demo-token"}


def get_current_user(request: Request) -> Dict[str, Any]:
    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
    token = auth[len("Bearer "):].strip()
    if not token:
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        
    sb_client = get_supabase()
    if not sb_client:
        raise HTTPException(status_code=500, detail="DB is not configured")
        
    try:
        res = sb_client.auth.get_user(token)
    except Exception:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")
    if not res or not res.user:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")
    return {"id": res.user.id, "email": res.user.email or "", "token": token}
