import os
import json
import logging
from typing import Tuple

logger = logging.getLogger("plant_wiki.spam_filter")

# 빠른 1차 키워드 휴리스틱 필터링 (초고속 차단)
BLOCKED_KEYWORDS = {
    "카지노", "바카라", "토토", "조건만남", "출장만남", "출장마사지", "대포통장",
    "불법대출", "텔레그램방", "성인용품", "야동", "섹스", "자위", "성매매",
    "씨발", "시발", "개새끼", "병신", "존나", "지랄", "새끼야", "닥쳐", "꺼져"
}

def check_content_safety(text: str) -> Tuple[bool, str]:
    """
    초경량 AI 모델(Gemini Flash)과 휴리스틱 규칙을 결합하여
    커뮤니티 게시글의 스팸, 욕설, 광고, 유해성을 0.3초 내로 실시간 검사합니다.
    반환값: (is_safe: bool, reason: str)
    """
    if not text or not text.strip():
        return False, "내용을 입력해 주세요."

    clean_text = text.strip()

    # 1. 1차 로컬 휴리스틱 검사 (0.001초 컷)
    for kw in BLOCKED_KEYWORDS:
        if kw in clean_text:
            logger.info("Heuristic blocked keyword: %s", kw)
            return False, f"부적절하거나 불쾌감을 주는 단어('{kw}')가 포함되어 있습니다."

    # 2. 2차 Gemini 초경량 Flash 모델 AI 실시간 검토
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return True, ""

    try:
        from google import genai
        from google.genai import types

        # 타임아웃 3초로 지연 최소화
        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=3000))
        prompt = f"""
너는 다정한 식물 애호가들을 위한 커뮤니티의 실시간 AI 안전 모니터링 봇이야.
아래 사용자가 작성한 글이 다음 중 하나에 해당하는지 엄격하게 검사해:
1) 도박, 성인물, 마약, 불법 홍보, 텔레그램 리딩방 등 스팸 광고
2) 타인에 대한 심한 욕설, 조롱, 혐오 발언, 비하
3) 의미 없는 문자 반복 등 악의적인 도배

[작성된 글]:
"{clean_text}"

반드시 아래 JSON 형식으로만 답해. 다른 말은 절대 하지 마:
{{"is_safe": true, "reason": ""}}
또는
{{"is_safe": false, "reason": "차단된 사유 (한 문장)"}}
"""
        # 가장 빠르고 가벼운 Flash 모델 사용
        candidates = ["gemini-2.0-flash", "gemini-1.5-flash", "gemini-flash-latest"]
        for model in candidates:
            try:
                res = client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.1,
                        response_mime_type="application/json"
                    )
                )
                if res and res.text:
                    parsed = json.loads(res.text.strip())
                    is_safe = bool(parsed.get("is_safe", True))
                    reason = str(parsed.get("reason", ""))
                    if not is_safe:
                        logger.warning("Gemini AI blocked post: reason=%s", reason)
                        return False, reason or "커뮤니티 가이드라인에 위배되는 내용이 감지되었습니다."
                    return True, ""
            except Exception as m_err:
                logger.debug("Model %s moderation check skipped: %s", model, m_err)
                continue

    except Exception as e:
        logger.warning("Spam filter AI call exception: %s. Allowing fallback.", e)

    return True, ""
