from typing import Dict, Any
from fastapi import Request, HTTPException
from app.services.database import get_supabase

def get_current_user_or_fallback(request: Request) -> Dict[str, Any]:
    import os
    import hashlib
    DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"
    
    auth = request.headers.get("Authorization", "")
    device_id = request.headers.get("X-Device-Id", "").strip()
    device_email = request.headers.get("X-Device-Email", "").strip()
    sb_client = get_supabase()
    
    if sb_client is not None and not DEV_MODE:
        if auth.startswith("Bearer "):
            token = auth[len("Bearer "):].strip()
            if token:
                try:
                    res = sb_client.auth.get_user(token)
                    if res and res.user:
                        return {"id": res.user.id, "email": res.user.email or "", "token": token}
                except Exception:
                    pass
        # 토큰이 만료되었거나 검증 실패했더라도, 같은 기기 헤더가 유효하면 기기 세션으로 영구 유지
        if device_email:
            safe_id = hashlib.md5(device_email.lower().encode()).hexdigest()
            return {"id": safe_id, "email": device_email, "token": f"device-token-{safe_id}"}
        raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
        
    # Supabase 미설정시 또는 DEV_MODE일때
    if device_email:
        safe_id = hashlib.md5(device_email.lower().encode()).hexdigest()
        return {"id": safe_id, "email": device_email, "token": f"device-token-{safe_id}"}
    return {"id": "demo-user", "email": "demo@plantwiki.local", "token": "demo-token"}


def get_current_user(request: Request) -> Dict[str, Any]:
    import hashlib
    auth = request.headers.get("Authorization", "")
    device_id = request.headers.get("X-Device-Id", "").strip()
    device_email = request.headers.get("X-Device-Email", "").strip()

    sb_client = get_supabase()
    if not sb_client:
        if device_email:
            safe_id = hashlib.md5(device_email.lower().encode()).hexdigest()
            return {"id": safe_id, "email": device_email, "token": f"device-token-{safe_id}"}
        raise HTTPException(status_code=500, detail="DB is not configured")
        
    if auth.startswith("Bearer "):
        token = auth[len("Bearer "):].strip()
        if token:
            try:
                res = sb_client.auth.get_user(token)
                if res and res.user:
                    return {"id": res.user.id, "email": res.user.email or "", "token": token}
            except Exception:
                pass
    # 기기 세션 폴백
    if device_email:
        safe_id = hashlib.md5(device_email.lower().encode()).hexdigest()
        return {"id": safe_id, "email": device_email, "token": f"device-token-{safe_id}"}
    raise HTTPException(status_code=401, detail="로그인이 필요합니다.")
