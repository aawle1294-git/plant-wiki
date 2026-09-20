import os
import re
import json
import logging
import asyncio
import httpx
import uuid
from collections import defaultdict
from datetime import datetime, date, timedelta, timezone
from typing import Optional, Dict, Any, List

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel

from supabase import create_client

# Configure Structured Logging
from logging_config import setup_logging
setup_logging(level=os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("plant_wiki")


app = FastAPI(
    title="AI Plant Wikipedia - Da Vinci Fusion School",
    description="제10기 다빈치융합스쿨 탐구과제를 위한 AI 중심 식물 위키백과 웹 서비스 (Supabase 연동)",
    version="2.0.0"
)


def _load_dotenv():
    """프로젝트 루트의 .env 파일에서 SUPABASE_URL / SUPABASE_ANON_KEY 등을 로드한다."""
    path = os.path.join(os.path.dirname(__file__), ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

# Template Engine Setup
TEMPLATES_DIR = os.path.join(os.path.dirname(__file__), "templates")
os.makedirs(TEMPLATES_DIR, exist_ok=True)
templates = Jinja2Templates(directory=TEMPLATES_DIR)

STATIC_DIR = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# PWA: Service Worker를 루트 스코프(/)에서 제공 (오프라인 부팅 & 앱 설치 지원)
SW_PATH = os.path.join(STATIC_DIR, "sw.js")

@app.get("/sw.js")
async def service_worker():
    return FileResponse(
        SW_PATH,
        media_type="application/javascript",
        headers={"Service-Worker-Allowed": "/", "Cache-Control": "no-cache"},
    )

# 개발 모드 플래그 (google-quick 등 개발용 기능 제어)
DEV_MODE = os.environ.get("DEV_MODE", "false").lower() == "true"

# Gemini 모델 설정: 안정적인 모델 우선, 실패 시 순차 폴백
GEMINI_MODEL_CANDIDATES = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-3-flash-preview",
]

# ===================== 식물 가드레일 (비식물 검색어 차단) =====================
GUARDRAIL_MESSAGE = "Plant!p은 식물 탐구를 위한 공간이에요! 🌱"

NON_PLANT_KEYWORDS = {
    "강아지", "개", "고양이", "토끼", "햄스터", "자동차", "차", "컴퓨터", "노트북",
    "핸드폰", "휴대폰", "로봇", "자전거", "버스", "비행기", "기차", "의자", "책상",
    "게임", "영화", "음악", "사람", "친구", "학교", "밥", "김치", "돈까스", "치킨", "피자",
    "돌", "구름", "바람", "집", "아파트", "옷", "신발", "가방", "우산",
    "dog", "cat", "rabbit", "car", "computer", "robot", "bike", "bus", "plane",
    "train", "chair", "desk", "game", "movie", "music", "human", "food",
    "rock", "cloud", "house", "shirt", "shoe",
}


def looks_like_non_plant(plant_name: str) -> bool:
    return plant_name.strip().lower() in NON_PLANT_KEYWORDS


# ===================== Supabase 클라우드 바인딩 =====================
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").strip()
SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "").strip()

from app.services.database import get_supabase, require_supabase, user_client
from app.core.deps import get_current_user, get_current_user_or_fallback
from app.services.memory import MEMORY_HISTORY, MEMORY_PROFILES, MEMORY_LEAF_TX, MEMORY_WATERING_SCHEDULES, _save_memory
from app.services.profile import (
    ensure_profile as _ensure_profile,
    update_profile as _update_profile,
    add_leaf_transaction as _add_leaf_transaction,
    do_streak_checkin as _do_streak_checkin
)
from app.services.watering import (
    ensure_watering_schedule as _ensure_watering_schedule,
    get_watering_schedules as _get_watering_schedules,
    update_watering_schedule as _update_watering_schedule,
    delete_watering_schedule as _delete_watering_schedule,
    mark_watered as _mark_watered
)
from app.services.history import (
    insert_plant_history as _insert_plant_history,
    get_memory_history as _get_memory_history,
    delete_memory_history as _delete_memory_history
)

sb_client = get_supabase()

def _require_supabase():
    require_supabase()

def _require_supabase_or_fallback():
    return get_supabase() is not None

def _get_current_user_or_fallback(request: Request) -> Dict[str, Any]:
    return get_current_user_or_fallback(request)

def _get_current_user(request: Request) -> Dict[str, Any]:
    return get_current_user(request)

def _user_client(token: str):
    return user_client(token)



from app.models.domain import *

# Default Plant Knowledge Base (Intelligent Fallback Engine for offline / keyless testing)
PRESET_PLANTS = {
    "토마토": {
        "name": "토마토",
        "scientific_name": "Solanum lycopersicum",
        "emoji": "🍅",
        "summary": "빨갛고 맛있는 토마토는 사실 채소가 아니라 열매채소(과채류)예요! 햇빛을 아주 좋아하고 맛있는 비타민이 가득하답니다.",
        "watering": "흙 표면이 말랐을 때 듬뿍 (주 2~3회)",
        "sunlight": "하루 6시간 이상 햇빛이 쨍쨍 내리쬐는 장소 ☀️",
        "temperature": "20°C ~ 28°C (따뜻한 날씨를 좋아해요)",
        "difficulty": "🌱 초보자 추천 (쉬움)",
        "kids_tip": "토마토 줄기를 살살 문지르면 향긋한 토마토 냄새가 나요! 곁순(줄기 사이 싹)을 따주면 열매가 더 크게 자란답니다.",
        "fun_fact": "토마토는 토마틴이라는 성분 덕분에 벌레로부터 자신을 보호해요!",
        "pests": [
            {"name": "역병", "symptom": "잎에 갈색 얼룩이 생기고 시들어요", "treatment": "병든 잎을 바로 떼어내고 통풍을 좋게 해요"},
            {"name": "진딧물", "symptom": "잎 뒷면에 작은 벌레가 모여 있어요", "treatment": "물로 씻어내거나 희석한 비눗물을 뿌려요"},
            {"name": "담배나방", "symptom": "열매에 구멍이 뚫려 있어요", "treatment": "애벌레를 잡아 없애고 열매를 종이봉투로 감싸요"}
        ],
        "belief_check": {
            "myth": "토마토는 물을 많이 줄수록 더 맛있고 크게 자란다!",
            "verdict": False,
            "true_percent": 30,
            "false_percent": 70,
            "summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 물을 너무 많이 주면 뿌리가 물러지고 당도가 떨어져요."
        },
    },
    "상추": {
        "name": "상추",
        "scientific_name": "Lactuca sativa",
        "emoji": "🥬",
        "summary": "고기 먹을 때 빠질 수 없는 상추! 씨앗을 심고 3~4주면 잎을 수확해서 바로 먹을 수 있을 정도로 자라는 속도가 빨라요.",
        "watering": "겉흙이 마르면 촉촉하게 (2일에 1번)",
        "sunlight": "반양지 (하루 3~4시간 햇빛이면 충분해요) ⛅",
        "temperature": "15°C ~ 20°C (서늘한 날씨를 좋아해요)",
        "difficulty": "🌱 초보자 추천 (아주 쉬움)",
        "kids_tip": "바깥쪽 큰 잎부터 차례대로 잘라 수확하면 안쪽에서 새 잎이 계속 올라와서 오랫동안 먹을 수 있어요!",
        "fun_fact": "상추 잎을 자르면 나오는 하얀 즙에는 '락투카리움'이라는 성분이 들어있어 마음을 편안하게 해줘요.",
        "pests": [
            {"name": "진딧물", "symptom": "잎이 말리고 작은 벌레가 붙어요", "treatment": "물로 씻어내고 환기를 자주 시켜요"},
            {"name": "노균병", "symptom": "잎이 누렇게 변하고 하얀 곰팡이가 생겨요", "treatment": "병든 잎을 제거하고 물주기를 줄여요"},
            {"name": "달팽이·민달팽이", "symptom": "잎에 구멍이 뚫리고 끈적한 자국이 있어요", "treatment": "저녁에 손으로 잡아주고 계란 껍질 가루를 뿌려요"}
        ],
        "belief_check": {
            "myth": "상추는 물을 많이 줄수록 더 아삭하고 맛있어진다!",
            "verdict": True,
            "true_percent": 75,
            "false_percent": 25,
            "summary": "AI 분석 결과: 이 상식은 대체로 사실이에요! 수분이 충분해야 잎이 아삭하게 자라요. 다만 과습은 주의해야 해요."
        },
    },
    "몬스테라": {
        "name": "몬스테라",
        "scientific_name": "Monstera deliciosa",
        "emoji": "🪴",
        "summary": "구멍 뚫린 멋진 잎을 가진 대표적인 관엽식물이에요! 열대 우림 출신이라 잎이 커지면서 바람과 빛을 아래 잎으로 전달하기 위해 구멍이 뚫려요.",
        "watering": "속흙까지 말랐을 때 듬뿍 (7~10일에 1번)",
        "sunlight": "밝은 음지나 창가를 통한 간접 광 🌤️",
        "temperature": "20°C ~ 30°C (겨울철 추위 조심)",
        "difficulty": "🌿 보통 (쉽게 키울 수 있어요)",
        "kids_tip": "잎에 먼지가 쌓이면 숨을 쉬기 힘드니 젖은 수건으로 살살 닦아주면 광합성을 훨씬 잘해요!",
        "fun_fact": "몬스테라라는 이름은 라틴어로 '괴물(Monster)' 같은 거대한 모양에서 유래되었답니다.",
        "pests": [
            {"name": "뿌리썩음병", "symptom": "잎이 축 처지고 뿌리가 물러져요", "treatment": "물을 줄이고 배수가 잘 되는 흙으로 갈아줘요"},
            {"name": "깍지벌레", "symptom": "잎과 줄기에 하얀 솜 같은 벌레가 붙어요", "treatment": "면봉에 알코올을 묻혀 닦아내요"},
            {"name": "잎마름", "symptom": "잎 끝이 갈색으로 타들어가요", "treatment": "물을 충분히 주고 잎에 분무로 습도를 높여줘요"}
        ],
        "belief_check": {
            "myth": "몬스테라는 물을 거의 안 줘도 잘 자란다!",
            "verdict": False,
            "true_percent": 20,
            "false_percent": 80,
            "summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 몬스테라는 겉흙이 마를 때쯤 물을 주어야 잎이 시들지 않아요."
        },
    },
    "선인장": {
        "name": "선인장",
        "scientific_name": "Cactaceae",
        "emoji": "🌵",
        "summary": "사막의 생존왕 선인장! 가시는 원래 잎이었는데, 물이 증발하는 것을 막고 동물로부터 자신을 지키기 위해 가시로 변했어요.",
        "watering": "흙이 완전히 바짝 말랐을 때 조금만 (월 1~2회)",
        "sunlight": "하루 종일 강한 햇빛 ☀️☀️",
        "temperature": "18°C ~ 35°C (건조하고 따뜻한 곳)",
        "difficulty": "🌱 초보자 추천 (손이 많이 안 가요)",
        "kids_tip": "선인장은 물을 너무 많이 주면 뿌리가 썩을 수 있으니 '잊어버릴 때쯤' 한 번씩 주는 게 포인트예요!",
        "fun_fact": "선인장 줄기 속은 스펀지 같아서 몸무게의 90% 이상을 물로 채울 수 있답니다.",
        "pests": [
            {"name": "뿌리썩음병", "symptom": "아랫부분이 물러지고 노래져요", "treatment": "물주기를 확 줄이고 흙을 건조하게 두세요"},
            {"name": "응애", "symptom": "겉에 하얀 반점과 거미줄이 보여요", "treatment": "물로 씻고 햇빛이 잘 드는 곳에 두세요"},
            {"name": "깍지벌레", "symptom": "가시 사이에 하얀 가루가 붙어요", "treatment": "면봉으로 닦아내고 환기를 시켜요"}
        ],
        "belief_check": {
            "myth": "선인장은 물을 아예 안 줘도 오래 산다!",
            "verdict": False,
            "true_percent": 10,
            "false_percent": 90,
            "summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 선인장도 가끔은 물이 필요해요. 다만 주기는 길게, 양은 적게가 정답이에요."
        },
    },
    "해바라기": {
        "name": "해바라기",
        "scientific_name": "Helianthus annuus",
        "emoji": "🌻",
        "summary": "태양을 사랑하는 노란 꽃 해바라기! 자라는 동안 꽃봉오리가 해를 따라 동쪽에서 서쪽으로 고개를 돌리는 신기한 식물이에요.",
        "watering": "흙 표면이 마르면 듬뿍 (일주일에 2~3회)",
        "sunlight": "하루 8시간 이상 직사광선 ☀️",
        "temperature": "20°C ~ 30°C (여름철 완벽 성장)",
        "difficulty": "🌱 초보자 추천",
        "kids_tip": "씨앗 하나에서 키가 2미터 넘게 자라요! 화분 크기가 클수록 해바라기도 커진답니다.",
        "fun_fact": "해바라기 꽃 한 송이는 사실 수천 개의 아주 작은 꽃들이 모여 만들어진 커다란 꽃밭이에요!",
        "pests": [
            {"name": "진딧물", "symptom": "잎에 작은 벌레가 모여 있어요", "treatment": "물로 씻어내고 희석한 비눗물을 뿌려요"},
            {"name": "흰가루병", "symptom": "잎에 하얀 가루가 묻은 것 같아요", "treatment": "통풍을 좋게 하고 병든 잎을 제거해요"},
            {"name": "노균병", "symptom": "잎에 노란 얼룩이 생겨요", "treatment": "물이 잎에 닿지 않게 주고 병든 잎을 떼어내요"}
        ],
        "belief_check": {
            "myth": "해바라기는 항상 해가 있는 방향을 바라본다!",
            "verdict": True,
            "true_percent": 70,
            "false_percent": 30,
            "summary": "AI 분석 결과: 이 상식은 대체로 사실이에요! 다만 어린 시절만 해를 따라 돌고, 꽃이 핀 뒤에는 동쪽을 바라보며 고정돼요."
        },
    },
    "바질": {
        "name": "바질",
        "scientific_name": "Ocimum basilicum",
        "emoji": "🌿",
        "summary": "피자와 파스타에 넣으면 향긋함이 폭발하는 허브의 왕 바질! 싱그러운 녹색 잎과 향기가 매력적이에요.",
        "watering": "겉흙이 마르면 잎이 시들기 전에 듬뿍 (2~3일에 1번)",
        "sunlight": "햇빛이 잘 드는 창가 (하루 5시간 이상) ☀️",
        "temperature": "20°C ~ 28°C (추위에 매우 약해요)",
        "difficulty": "🌿 보통",
        "kids_tip": "줄기 맨 위쪽 잎을 수확(순지르기)해주면 옆으로 가지가 갈라지면서 바질이 풍성해져요!",
        "fun_fact": "고대 이집트에서는 바질을 국왕의 향수로 사용하기도 했어요.",
        "pests": [
            {"name": "진딧물", "symptom": "잎이 말리고 벌레가 붙어요", "treatment": "물로 씻어내고 햇볕이 좋은 곳에 두세요"},
            {"name": "흰가루병", "symptom": "잎에 하얀 가루가 생겨요", "treatment": "통풍을 좋게 하고 병든 잎을 제거해요"},
            {"name": "뿌리썩음병", "symptom": "잎이 축 처지고 노래져요", "treatment": "물을 너무 자주 주지 말고 화분 배수 구멍을 확인해요"}
        ],
        "belief_check": {
            "myth": "바질은 잎을 많이 따면 따는 대로 죽어버린다!",
            "verdict": False,
            "true_percent": 15,
            "false_percent": 85,
            "summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 오히려 위쪽 잎을 따주면 가지가 갈라져 더 풍성하게 자라요."
        },
    },
    "딸기": {
        "name": "딸기",
        "scientific_name": "Fragaria × ananassa",
        "emoji": "🍓",
        "summary": "새콤달콤 빨간 딸기! 하얀 꽃이 피고 벌들이 수정해주면 상큼한 딸기 열매가 맺혀요.",
        "watering": "흙이 촉촉하게 유지되도록 (2일에 1번)",
        "sunlight": "햇빛이 풍부한 양지 (하루 6시간) ☀️",
        "temperature": "17°C ~ 23°C",
        "difficulty": "🌿 보통",
        "kids_tip": "딸기 열매가 흙에 닿으면 썩을 수 있으니 짚이나 비닐을 바닥에 깔아주면 예쁘게 자라요!",
        "fun_fact": "딸기 겉면에 콕콕 박혀 있는 깨 같은 정체는 씨앗이 아니라 사실 씨앗을 품은 '열매'들이에요!",
        "pests": [
            {"name": "진딧물", "symptom": "잎에 벌레가 붙어 있어요", "treatment": "물로 씻어내고 통풍을 좋게 해요"},
            {"name": "잿빛곰팡이병", "symptom": "열매에 회색 곰팡이가 생겨요", "treatment": "병든 열매를 바로 떼어내고 습기를 줄여요"},
            {"name": "달팽이", "symptom": "열매에 구멍이 나요", "treatment": "저녁에 잡아주고 흙 위에 달팽이 방지재를 둘러요"}
        ],
        "belief_check": {
            "myth": "딸기의 씨앗은 열매 속 깊숙한 곳에 있다!",
            "verdict": False,
            "true_percent": 20,
            "false_percent": 80,
            "summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 딸기 겉면의 깨 같은 점이 바로 씨앗(열매)이에요. 바깥에 콕콕 박혀 있답니다."
        },
    },
}

# 인메모리 지식 캐시 (SQLite 제거 후 Gemini 중복 호출/레이트리밋 방지)
PLANT_CACHE: Dict[str, Dict[str, Any]] = {}


def _normalize_belief_check(bc):
    """찬반 그래프 데이터를 클램프+합 100 보장 dict로 정규화한다."""
    if not isinstance(bc, dict):
        return None
    try:
        true_pct = max(0, min(100, int(bc.get("true_percent"))))
        false_pct = max(0, min(100, int(bc.get("false_percent"))))
    except (TypeError, ValueError):
        true_pct, false_pct = 50, 50
    if true_pct + false_pct != 100:
        total = true_pct + false_pct
        if total <= 0:
            true_pct, false_pct = 50, 50
        else:
            true_pct = round(true_pct * 100 / total)
            false_pct = 100 - true_pct
    return {
        "myth": bc.get("myth") or "알려진 재배 상식",
        "verdict": bool(bc.get("verdict", true_pct >= 50)),
        "true_percent": true_pct,
        "false_percent": false_pct,
        "summary": bc.get("summary") or "AI 분석 결과: 해당 상식을 판별했어요.",
    }


def _assemble_deep_link(*fragments: str) -> str:
    """공백 제거 후 이중 스킴(:/+/:)을 정규화해 완전한 상세 URL을 반환한다."""
    url = re.sub(r"\s+", "", "".join(fragments))
    return re.sub(r":/{2,}(?::/{2,})+", "://", url)


# 적상추만 라운드 7 조각(/ms/products/, 실측 404)의 대체로 prdm 형식(www로 리다이렉트)을 유지하고,
# 나머지 다이소몰 상세 URL은 www/pd/pdr 정규형(실측 200)을 사용한다.
TOMATO_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/101906272?itemId=23627156646&vendorItemId=92799712096&pickType=COU_PICK&q=%ED%86%A0%EB%A7%88%ED%86%A0+%EC%94%A8&searchId=0d919992173697&sourceType=search&itemsCount=60&searchRank=1&rank=1&traceId=msvpf95n"
)
CHERRY_TOMATO_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1013554&recmYn=N"
)
CHICORY_DETAIL_URL = _assemble_deep_link("https://", "://asiaseedmall.com")
LETTUCE_DETAIL_URL = _assemble_deep_link(
    "https://www.asiaseedmall.com/goods/goods_view.php?goodsNo=1000002047"
)
BEET_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=56015&recmYn=N"
)
GARLIC_CHIVES_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43127&recmYn=N"
)
COSMOS_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=47910&recmYn=N"
)
YOUNG_RADISH_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43129&recmYn=N"
)
BALSAM_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43134&recmYn=N"
)
CARROT_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=57782&recmYn=N"
)
SPINACH_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43130&recmYn=N"
)
ALTARI_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=46413&recmYn=N"
)
BEET_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=56015&recmYn=N"
)
GARLIC_CHIVES_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43127&recmYn=N"
)
COSMOS_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=47910&recmYn=N"
)
YOUNG_RADISH_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43129&recmYn=N"
)
BALSAM_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43134&recmYn=N"
)
CARROT_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=57782&recmYn=N"
)
SPINACH_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43130&recmYn=N"
)
FLOWERING_LETTUCE_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=46416&recmYn=N"
)
SUNFLOWER_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43135&recmYn=N"
)
RED_MUSTARD_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=56021&recmYn=N"
)
CROWN_DAISY_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43133&recmYn=N"
)
LEAF_CHICORY_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=46418&recmYn=N"
)
LAVENDER_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=57781&recmYn=N"
)
SCALLION_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43132&recmYn=N"
)
BASIL_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=47918&recmYn=N"
)
CUCUMBER_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9627720579?itemId=28754407684&vendorItemId=95693224442&q=%EC%98%A4%EC%9D%B4%EC%94%A8%EC%95%97&searchId=50ae76f313385969&sourceType=search&itemsCount=60&searchRank=0&rank=0&traceId=msvr7cej"
)
EGGPLANT_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9349374161?itemId=27734919226&vendorItemId=94696140005&q=%EA%B0%80%EC%A7%80+%EC%94%A8%EC%95%97&searchId=0a62cbab11677984&sourceType=search&itemsCount=60&searchRank=3&rank=3&traceId=msvr9g1g"
)
# Step 1 (2026-08-16): UI 노출 4종 + 상추 상세 딥링크 승격
MONSTERA_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/8335561887?itemId=24068771655&vendorItemId=83899975946"
)
CACTUS_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9369379695"
)
STRAWBERRY_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/8453838228"
)
ROSEMARY_DETAIL_URL = _assemble_deep_link(
    "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=43140&recmYn=N"
)

# Step 2 (2026-08-26): 텃밭 대표 채소 10종 정식 디렉터리 승격 — 실측 정적 상세 딥링크
PEPPER_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9466169416"
)
CABBAGE_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/5878083618?itemId=10302204303&vendorItemId=77584504169"
)
RADISH_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9426532183"
)
POTATO_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/5202752724"
)
SWEET_POTATO_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9090108700"
)
PUMPKIN_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9019197972"
)
CORN_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9440689258"
)
PEA_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/7324976706"
)
BEAN_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/9417605905"
)
KALE_DETAIL_URL = _assemble_deep_link(
    "https://www.coupang.com/vp/products/8642123272"
)

PURCHASE_URLS = [
    ("방울토마토", CHERRY_TOMATO_DETAIL_URL),
    ("토마토", TOMATO_DETAIL_URL),
    ("양상추", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=양상추"),
    ("상추", LETTUCE_DETAIL_URL),
    ("바질", "https://garamone.com"),
    ("라벤더", "https://garamone.com"),
    ("허브", "https://garamone.com"),
    # ① 앱 UI 노출 식물 (최우선, Step 1 상세 딥링크 승격 완료)
    ("몬스테라", MONSTERA_DETAIL_URL),
    ("선인장", CACTUS_DETAIL_URL),
    ("딸기", STRAWBERRY_DETAIL_URL),
    ("로즈마리", ROSEMARY_DETAIL_URL),
    # ② 주요 채소·과일 (17종)
    ("고추", PEPPER_DETAIL_URL),
    ("배추", CABBAGE_DETAIL_URL),
    ("무", RADISH_DETAIL_URL),
    ("양파", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=양파"),
    ("마늘", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=마늘"),
    ("감자", POTATO_DETAIL_URL),
    ("고구마", SWEET_POTATO_DETAIL_URL),
    ("호박", PUMPKIN_DETAIL_URL),
    ("옥수수", CORN_DETAIL_URL),
    ("완두", PEA_DETAIL_URL),
    ("강낭콩", BEAN_DETAIL_URL),
    ("케일", KALE_DETAIL_URL),
    ("청경채", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=청경채"),
    ("브로콜리", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=브로콜리"),
    ("미나리", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=미나리"),
    ("파슬리", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=파슬리"),
    # ③ 꽃·허브 (9종)
    ("메리골드", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=메리골드"),
    ("백일홍", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=백일홍"),
    ("맨드라미", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=맨드라미"),
    ("금잔화", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=금잔화"),
    ("팬지", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=팬지"),
    ("튤립", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=튤립"),
    ("채송화", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=채송화"),
    ("민트", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=민트"),
    ("고수", "https://www.asiaseedmall.com/goods/goods_search.php?keyword=고수"),
]
DEFAULT_PURCHASE_URL = "https://asiaseedmall.com"

PLANT_DIRECTORY_SEED = [
    {
        "name": "토마토",
        "scientific_name": "Solanum lycopersicum",
        "myth": "토마토는 물을 많이 줄수록 열매가 커진다!",
        "verdict": False,
        "true_percent": 30,
        "false_percent": 70,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 과습하면 열과(열매 터짐)와 당도 저하가 생깁니다. 겉흙이 마른 뒤 규칙적으로 주는 게 좋아요.",
        "purchase_url": TOMATO_DETAIL_URL,
    },
    {
        "name": "방울토마토",
        "scientific_name": "Solanum lycopersicum var. cerasiforme",
        "myth": "방울토마토는 물을 매일 듬뿍 주어야 잘 자란다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 과습하면 뿌리가 썩고 열매가 터질 수 있으니 겉흙이 마른 뒤에 듬뿍 주는 게 좋아요.",
        "purchase_url": CHERRY_TOMATO_DETAIL_URL,
    },
    {
        "name": "적치콘",
        "scientific_name": "Cichorium intybus var. foliosum",
        "myth": "적치콘은 어두운 곳에서 재배해야 붉은빛이 선명해진다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 트레비소 특유의 붉은색은 저온과 충분한 광량에서 발현됩니다. 차광은 잎을 연하게 만들 뿐입니다.",
        "purchase_url": CHICORY_DETAIL_URL,
    },
    {
        "name": "트레비소",
        "scientific_name": "Cichorium intybus var. foliosum",
        "myth": "트레비소는 고온에서 키워야 붉은색이 진해진다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 트레비소의 붉은색은 저온과 충분한 광량에서 발현됩니다. 고온에서는 오히려 초록빛이 강해집니다.",
        "purchase_url": CHICORY_DETAIL_URL,
    },
    {
        "name": "적상추",
        "scientific_name": "Lactuca sativa",
        "myth": "상추는 햇빛이 안 드는 서늘한 그늘에서만 키워야 한다!",
        "verdict": False,
        "true_percent": 15,
        "false_percent": 85,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 광량이 부족하면 줄기만 길게 자라 잎이 연약해집니다. 하루 4시간 이상 햇빛이 필요해요.",
        "purchase_url": LETTUCE_DETAIL_URL,
    },
    {
        "name": "비트",
        "scientific_name": "Beta vulgaris",
        "myth": "비트는 물을 많이 줄수록 뿌리가 더 크고 빨개진다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 과습하면 뿌리가 물러지고 당도가 떨어집니다. 겉흙이 마른 뒤에 규칙적으로 주는 게 좋아요.",
        "purchase_url": BEET_DETAIL_URL,
    },
    {
        "name": "부추",
        "scientific_name": "Allium tuberosum",
        "myth": "부추는 자주 베어내면 뿌리가 죽어 다시 자라지 않는다!",
        "verdict": False,
        "true_percent": 15,
        "false_percent": 85,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 부추는 수확할수록 새순이 왕성하게 자라는 다년생 작물입니다. 오히려 자주 수확하는 게 품질 유지에 좋아요.",
        "purchase_url": GARLIC_CHIVES_DETAIL_URL,
    },
    {
        "name": "코스모스",
        "scientific_name": "Cosmos bipinnatus",
        "myth": "코스모스는 비옥한 땅에서만 꽃이 핀다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 코스모스는 오히려 메마르고 척박한 땅에서 꽃이 더 풍성하게 핍니다. 비료가 과하면 줄기만 자라고 꽃이 적어요.",
        "purchase_url": COSMOS_DETAIL_URL,
    },
    {
        "name": "열무",
        "scientific_name": "Raphanus sativus var. hortensis",
        "myth": "열무는 잎을 많이 따면 뿌리가 더 굵어진다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 잎을 과하게 따면 광합성이 줄어 오히려 뿌리가 작아집니다. 속잎만 조금씩 따는 게 좋아요.",
        "purchase_url": YOUNG_RADISH_DETAIL_URL,
    },
    {
        "name": "봉선화",
        "scientific_name": "Impatiens balsamina",
        "myth": "봉선화는 꽃이 지면 다시는 꽃이 피지 않는다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 꽃을 꾸준히 따주면 계속해서 새로운 꽃이 핍니다. 시든 꽃을 제거하면 개화 기간이 길어져요.",
        "purchase_url": BALSAM_DETAIL_URL,
    },
    {
        "name": "당근",
        "scientific_name": "Daucus carota",
        "myth": "당근은 씨를 뿌린 뒤 가는 게 좋아 솎아주면 안 된다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 솎아주지 않으면 뿌리가 서로 경쟁해 작고 기형이 됩니다. 적정 간격으로 솎는 게 굵은 당근의 핵심이에요.",
        "purchase_url": CARROT_DETAIL_URL,
    },
    {
        "name": "시금치",
        "scientific_name": "Spinacia oleracea",
        "myth": "시금치는 여름에 심어야 더 잘 자란다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 시금치는 서늘한 기후를 좋아하는 내한성 작물로, 고온에서는 꽃대가 올라가 잎이 억세집니다. 봄·가을 재배가 적합해요.",
        "purchase_url": SPINACH_DETAIL_URL,
    },
    {
        "name": "알타리",
        "scientific_name": "Raphanus sativus",
        "myth": "알타리는 뿌리가 얇아서 물을 적게 줘야 한다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 알타리도 수분이 부족하면 뿌리가 억세고 매워집니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.",
        "purchase_url": ALTARI_DETAIL_URL,
    },
    {
        "name": "꽃상추",
        "scientific_name": "Lactuca sativa",
        "myth": "꽃상추는 꽃이 피면 잎이 더 맛있어진다!",
        "verdict": False,
        "true_percent": 15,
        "false_percent": 85,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 꽃대가 오르면 잎에 쓴맛이 생기고 억세집니다. 꽃이 피기 전에 수확하는 게 좋아요.",
        "purchase_url": FLOWERING_LETTUCE_DETAIL_URL,
    },
    {
        "name": "해바라기",
        "scientific_name": "Helianthus annuus",
        "myth": "해바라기는 하루 종일 태양을 따라 고개를 돌린다!",
        "verdict": False,
        "true_percent": 30,
        "false_percent": 70,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 해바라기는 어린 시절에만 태양을 따라가고, 성숙하면 동쪽을 바라보고 고정됩니다.",
        "purchase_url": SUNFLOWER_DETAIL_URL,
    },
    {
        "name": "적겨자",
        "scientific_name": "Brassica juncea",
        "myth": "적겨자는 잎이 빨간 만큼 매운맛이 항상 강하다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 매운맛은 품종과 재배 온도, 수확 시기에 따라 달라집니다. 붉은 색은 안토시아닌 색소로 매운맛과 직접 관련이 없어요.",
        "purchase_url": RED_MUSTARD_DETAIL_URL,
    },
    {
        "name": "쑥갓",
        "scientific_name": "Glebionis coronaria",
        "myth": "쑥갓은 꽃이 필수록 잎이 더 향긋해진다!",
        "verdict": False,
        "true_percent": 15,
        "false_percent": 85,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 꽃대가 오르면 잎이 억세지고 쓴맛이 강해집니다. 꽃이 피기 전 어린 잎을 수확하는 게 향이 좋아요.",
        "purchase_url": CROWN_DAISY_DETAIL_URL,
    },
    {
        "name": "치커리",
        "scientific_name": "Cichorium intybus",
        "myth": "치커리는 쓴맛 때문에 물에 오래 담가야 영양이 좋아진다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 물에 오래 담그면 수용성 비타민이 빠져나갑니다. 쓴맛은 품종 고유의 성질로, 살짝 데쳐 조리하는 게 영양 보존에 좋아요.",
        "purchase_url": LEAF_CHICORY_DETAIL_URL,
    },
    {
        "name": "라벤더",
        "scientific_name": "Lavandula angustifolia",
        "myth": "라벤더는 실내 습기가 많을수록 향이 더 강해진다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 라벤더는 건조하고 통풍이 좋은 환경에서 향 성분이 더 잘 축적됩니다. 과습하면 뿌리가 썩고 향도 약해져요.",
        "purchase_url": LAVENDER_DETAIL_URL,
    },
    {
        "name": "대파",
        "scientific_name": "Allium fistulosum",
        "myth": "대파는 흙을 높게 북주지 않아도 흰 부분이 길게 자란다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 흰 부분은 흙에 묻힌 만큼만 길어집니다. 북주기를 반복해야 흰 대가 길고 부드러워져요.",
        "purchase_url": SCALLION_DETAIL_URL,
    },
    {
        "name": "바질",
        "scientific_name": "Ocimum basilicum",
        "myth": "바질은 잎을 따지 않고 가만히 놔두어야 무성해진다!",
        "verdict": False,
        "true_percent": 10,
        "false_percent": 90,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 윗가지 순지르기를 해야 줄기가 풍성하게 갈라져 수확량이 늘어납니다.",
        "purchase_url": BASIL_DETAIL_URL,
    },
    {
        "name": "오이",
        "scientific_name": "Cucumis sativus",
        "myth": "오이는 수분이 많아서 물을 아껴 줘야 한다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 오이는 수분이 부족하면 열매가 꼬이고 쓴맛이 강해집니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.",
        "purchase_url": CUCUMBER_DETAIL_URL,
    },
    {
        "name": "가지",
        "scientific_name": "Solanum melongena",
        "myth": "가지는 물을 적게 줘야 열매가 더 맛있다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 수분이 부족하면 가지가 작아지고 껍질이 억세지며 쓴맛이 생깁니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.",
        "purchase_url": EGGPLANT_DETAIL_URL,
    },
    {
        "name": "몬스테라",
        "scientific_name": "Monstera deliciosa",
        "myth": "몬스테라는 물을 거의 안 줘도 잘 자란다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 몬스테라는 겉흙이 마를 때쯤 물을 주어야 잎이 시들지 않아요.",
        "purchase_url": MONSTERA_DETAIL_URL,
    },
    {
        "name": "선인장",
        "scientific_name": "Cactaceae",
        "myth": "선인장은 물을 아예 안 줘도 오래 산다!",
        "verdict": False,
        "true_percent": 10,
        "false_percent": 90,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 선인장도 가끔은 물이 필요해요. 다만 주기는 길게, 양은 적게가 정답이에요.",
        "purchase_url": CACTUS_DETAIL_URL,
    },
    {
        "name": "딸기",
        "scientific_name": "Fragaria × ananassa",
        "myth": "딸기의 씨앗은 열매 속 깊숙한 곳에 있다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 딸기 겉면의 깨 같은 점이 바로 씨앗(열매)이에요. 바깥에 콕콕 박혀 있답니다.",
        "purchase_url": STRAWBERRY_DETAIL_URL,
    },
    {
        "name": "로즈마리",
        "scientific_name": "Rosmarinus officinalis",
        "myth": "로즈마리는 물을 자주 줘야 더 향긋하게 자란다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 로즈마리는 건조한 토양을 좋아해요. 과습하면 뿌리가 썩고 향도 약해집니다. 흙이 완전히 마른 뒤에 주는 게 좋아요.",
        "purchase_url": ROSEMARY_DETAIL_URL,
    },
    {
        "name": "상추",
        "scientific_name": "Lactuca sativa",
        "myth": "상추는 물을 많이 줄수록 더 아삭하고 맛있어진다!",
        "verdict": True,
        "true_percent": 75,
        "false_percent": 25,
        "belief_summary": "AI 분석 결과: 이 상식은 대체로 사실이에요! 수분이 충분해야 잎이 아삭하게 자라요. 다만 과습은 주의해야 해요.",
        "purchase_url": LETTUCE_DETAIL_URL,
    },
    # Step 2 (2026-08-26): 텃밭 대표 채소 10종 정식 디렉터리 승격
    {
        "name": "고추",
        "scientific_name": "Capsicum annuum",
        "myth": "고추는 물을 많이 주면 매운맛이 약해진다!",
        "verdict": False,
        "true_percent": 35,
        "false_percent": 65,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 매운맛은 품종과 재배 환경(온도, 수분 스트레스)에 의해 결정됩니다. 오히려 적절한 수분 스트레스가 캡사이신 생성을 촉진할 수 있어요.",
        "purchase_url": PEPPER_DETAIL_URL,
    },
    {
        "name": "배추",
        "scientific_name": "Brassica rapa subsp. pekinensis",
        "myth": "배추는 잎이 크고 많을수록 속이 꽉 찬다!",
        "verdict": False,
        "true_percent": 30,
        "false_percent": 70,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 겉잎이 너무 많으면 양분이 분산되어 속이 느슨해집니다. 적정 밀식과 북주기로 속을 단단하게 채우는 게 중요해요.",
        "purchase_url": CABBAGE_DETAIL_URL,
    },
    {
        "name": "무",
        "scientific_name": "Raphanus sativus",
        "myth": "무는 물을 적게 줘야 뿌리가 단단하고 맛있다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 무는 수분이 부족하면 뿌리가 섬유질이 많아지고 억세지며 매워집니다. 겉흙이 마른 뒤에는 충분히 물을 주는 게 좋아요.",
        "purchase_url": RADISH_DETAIL_URL,
    },
    {
        "name": "감자",
        "scientific_name": "Solanum tuberosum",
        "myth": "감자는 싹이 튼 씨감자를 그대로 심어도 잘 자란다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 싹이 너무 길게 자란 씨감자는 넘어지거나 부러지기 쉽습니다. 싹을 2~3cm로 틔운 뒤 심는 게 정석이에요.",
        "purchase_url": POTATO_DETAIL_URL,
    },
    {
        "name": "고구마",
        "scientific_name": "Ipomoea batatas",
        "myth": "고구마는 씨고구마를 흙에 묻기만 하면 된다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 씨고구마는 30~35°C 온상에서 40~60일간 싹을 틔워 20~30cm 모종(순)을 잘라 심어야 뿌리가 잘 내리고 수확량이 좋아요.",
        "purchase_url": SWEET_POTATO_DETAIL_URL,
    },
    {
        "name": "호박",
        "scientific_name": "Cucurbita moschata",
        "myth": "호박은 넝쿨이 길게 뻗을수록 열매가 더 많이 달린다!",
        "verdict": False,
        "true_percent": 30,
        "false_percent": 70,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 넝쿨이 과도하게 자라면 양분이 잎으로만 가 열매가 작아집니다. 적정 길이에서 순지르기를 해 착과를 유도해야 해요.",
        "purchase_url": PUMPKIN_DETAIL_URL,
    },
    {
        "name": "옥수수",
        "scientific_name": "Zea mays",
        "myth": "옥수수는 한 포기만 심어도 수확할 수 있다!",
        "verdict": False,
        "true_percent": 15,
        "false_percent": 85,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 옥수수는 바람으로 꽃가루를 받는 풍매화 작물이라 최소 2줄 이상(또는 여러 포기) 밀식해야 수정이 잘 돼 알이 꽉 차요.",
        "purchase_url": CORN_DETAIL_URL,
    },
    {
        "name": "완두콩",
        "scientific_name": "Pisum sativum",
        "myth": "완두콩은 지지대 없이 바닥에 퍼뜨려 키워도 된다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 완두콩은 덩굴성 작물이라 지지대가 없으면 줄기가 땅에 닿아 병해충 피해가 커지고 수확도 어렵습니다. 반드시 지주를 세워 유인해야 해요.",
        "purchase_url": PEA_DETAIL_URL,
    },
    {
        "name": "강낭콩",
        "scientific_name": "Phaseolus vulgaris",
        "myth": "강낭콩은 물을 자주 주면 콩알이 굵어진다!",
        "verdict": False,
        "true_percent": 25,
        "false_percent": 75,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 개화기·착과기에는 수분이 필요하지만, 과습하면 뿌리 호흡이 안 돼 오히려 콩알이 작아집니다. 겉흙 마른 뒤 충분히 주는 게 정석입니다.",
        "purchase_url": BEAN_DETAIL_URL,
    },
    {
        "name": "케일",
        "scientific_name": "Brassica oleracea var. acephala",
        "myth": "케일은 여름 더위에 키워야 잎이 부드럽다!",
        "verdict": False,
        "true_percent": 20,
        "false_percent": 80,
        "belief_summary": "AI 분석 결과: 이 상식은 사실이 아니에요! 케일은 서늘한 기후(15~20°C)를 좋아하는 내한성 작물로, 고온에서는 잎이 억세지고 쓴맛이 강해집니다. 봄·가을 재배가 적합해요.",
        "purchase_url": KALE_DETAIL_URL,
    },
]


# 식물 별칭 정규화 맵 (검색어 → 디렉터리/프리셋 정확 키)
PLANT_ALIAS_MAP = {
    # 토마토류
    "방울 토마토": "방울토마토",
    "방울토마토": "방울토마토",
    "cherry tomato": "방울토마토",
    "cherrytomato": "방울토마토",
    "토마토": "토마토",
    "tomato": "토마토",
    # 상추류
    "적상추": "적상추",
    "꽃상추": "꽃상추",
    "상추": "상추",
    "lettuce": "상추",
    # 기타 주요 작물
    "고추": "고추",
    "배추": "배추",
    "무": "무",
    "감자": "감자",
    "고구마": "고구마",
    "호박": "호박",
    "옥수수": "옥수수",
    "완두콩": "완두콩",
    "강낭콩": "강낭콩",
    "케일": "케일",
    "시금치": "시금치",
    "쑥갓": "쑥갓",
    "치커리": "치커리",
    "적겨자": "적겨자",
    "부추": "부추",
    "열무": "열무",
    "알타리": "알타리",
    "당근": "당근",
    "비트": "비트",
    "대파": "대파",
    "바질": "바질",
    "로즈마리": "로즈마리",
    "라벤더": "라벤더",
    "오이": "오이",
    "가지": "가지",
    "딸기": "딸기",
    # 반려식물
    "몬스테라": "몬스테라",
    "선인장": "선인장",
    "해바라기": "해바라기",
    "봉선화": "봉선화",
    "코스모스": "코스모스",
    "적치콘": "적치콘",
    "트레비소": "트레비소",
}


def _normalize_plant_name(name: str) -> str:
    """검색어를 디렉터리/프리셋 키로 정규화."""
    key = (name or "").strip()
    no_space_key = re.sub(r"\s+", "", key)
    if key in PLANT_ALIAS_MAP:
        return PLANT_ALIAS_MAP[key]
    if no_space_key in PLANT_ALIAS_MAP:
        return PLANT_ALIAS_MAP[no_space_key]
    
    # 디렉터리에서 완전일치 찾기
    for row in PLANT_DIRECTORY_SEED:
        if row["name"] == key or row["name"] == no_space_key:
            return row["name"]
    return no_space_key


def _lookup_directory(plant_name: str) -> Optional[Dict[str, Any]]:
    name = _normalize_plant_name(plant_name)
    if not name:
        return None
    if sb_client is not None:
        try:
            res = sb_client.table("plant_directory").select("*").eq("name", name).execute()
            rows = list(res.data or [])
            if rows:
                return dict(rows[0])
        except Exception as e:
            logger.warning("plant_directory lookup failed (%s); using code seed.", e)
    for row in PLANT_DIRECTORY_SEED:
        if row["name"] == name:
            return dict(row)
    return None


def _resolve_purchase_url(plant_name: str) -> str:
    name = (plant_name or "").strip()
    for keyword, url in PURCHASE_URLS:
        if keyword in name:
            return url
    return DEFAULT_PURCHASE_URL


def _serialize_plant(data: Dict[str, Any]) -> Dict[str, Any]:
    d = dict(data)
    d.pop("is_plant", None)
    d["pests"] = data.get("pests") if isinstance(data.get("pests"), list) else []
    d["belief_check"] = _normalize_belief_check(data.get("belief_check"))
    d["purchase_url"] = data.get("purchase_url") or _resolve_purchase_url(data.get("name", ""))
    d["detailed_url"] = data.get("detailed_url") or d["purchase_url"]
    return d


def generate_plant_with_gemini(plant_name: str) -> Optional[Dict[str, Any]]:
    """Try generating plant wikipedia data using Google Gemini API."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        logger.info("GEMINI_API_KEY not found in environment. Using fallback generator.")
        return None

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=15000))

        prompt = f"""
너는 식물 전문 AI야. 아래 두 가지 규칙을 반드시 따라.

[규칙 1] '{plant_name}'이(가) 실제 존재하는 식물(나무, 풀, 꽃, 채소, 과일나무, 이끼, 버섯 등)인지 먼저 판단해.
기계, 자동차, 동물, 사람, 음식(식물이 아닌 가공식품), 장소, 사물, 개념어 등은 식물이 아니야.

[규칙 2-A] 만약 식물이 아니라면, 다른 필드 없이 아래 JSON 하나만 반환해:
{{"is_plant": false}}

[규칙 2-B] 만약 식물이 맞다면, 아래 필드를 전부 채운 JSON을 반환해:
{{
  "is_plant": true,
  "name": "{plant_name}",
  "scientific_name": "학명 (예: Solanum lycopersicum)",
  "emoji": "해당 식물과 어울리는 이모지 1개",
  "summary": "초등학생 눈높이에 맞춘 2~3문장 간결한 식물 소개",
  "watering": "물주기 방법 (예: 흙 표면이 말랐을 때 주 2회 듬뿍)",
  "sunlight": "햇빛 조건 (예: 하루 6시간 이상 햇빛 필요 ☀️)",
  "temperature": "적정 온도 (예: 20°C ~ 25°C)",
  "difficulty": "난이도 (🌱 초보자 추천 / 🌿 보통 / 🌳 세심한 주의 중 선택)",
  "kids_tip": "어린이가 직접 관찰하거나 키울 때 도움이 되는 꿀팁 1~2문장",
  "fun_fact": "식물에 관한 흥미롭고 신기한 사실 1문장",
  "pests": [
    {{"name": "병충해 이름", "symptom": "어떤 증상이 나타나는지", "treatment": "아이들도 실천할 수 있는 대처법"}}
  ],
  "belief_check": {{
    "myth": "이 식물에 대해 사람들이 흔히 오해하거나 믿는 유명한 재배 상식/루머 문장 1개",
    "verdict": true,
    "true_percent": 50,
    "false_percent": 50,
    "summary": "한 줄 요약 문장"
  }}
}}
pests 는 반드시 2~3개 항목을 가진 배열로 해줘.
belief_check.true_percent 와 false_percent 는 반드시 합이 100이 되게 해줘.
JSON 외의 다른 추가 설명 문장은 절대 포함하지 마.
"""
        for model in GEMINI_MODEL_CANDIDATES:
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        temperature=0.3,
                        response_mime_type="application/json"
                    )
                )

                if response and response.text:
                    text = response.text.strip()
                    data = json.loads(text)
                    data.setdefault("is_plant", True)
                    data["ai_generated"] = 1
                    logger.info(f"Gemini generation succeeded with model: {model}")
                    return data
            except Exception as model_err:
                logger.warning(f"Gemini model {model} failed: {model_err}. Trying next candidate...")
    except Exception as e:
        logger.warning(f"Gemini API call failed or rate-limited: {e}. Falling back to smart generator.")
        return None


def generate_fallback_plant_data(plant_name: str) -> Dict[str, Any]:
    """Fallback generator when Gemini API is unavailable or for unregistered plants."""
    clean_name = plant_name.strip()

    # 비식물 키워드는 폴백에서도 차단
    if looks_like_non_plant(clean_name):
        return {"is_plant": False}

    if clean_name in PRESET_PLANTS:
        res = dict(PRESET_PLANTS[clean_name])
        res["ai_generated"] = 0
        return res

    return {
        "name": clean_name,
        "scientific_name": f"{clean_name.capitalize()} spp.",
        "emoji": "🌱",
        "summary": f"{clean_name}(은)는 자연 속에서 싱그럽게 자라나는 신기한 식물이에요! 다빈치 융합스쿨 연구 노트에 기록해보세요.",
        "watering": "겉흙이 살짝 말랐을 때 뿌리까지 촉촉하게 주 1~2회 물을 주세요 💧",
        "sunlight": "바람이 잘 통하고 햇빛이 은은하게 드는 창가 ⛅",
        "temperature": "18°C ~ 25°C (사람이 쾌적하게 느끼는 온도)",
        "difficulty": "🌿 보통 (사랑과 관심으로 키워봐요)",
        "kids_tip": f"{clean_name}의 잎 크기와 키를 매주 식물 일기에 측정해 기록해보면 더 재미있게 관찰할 수 있어요!",
        "fun_fact": f"{clean_name}도 광합성을 통해 우리에게 깨끗한 산소를 만들어 선물해 준답니다!",
        "pests": [
            {"name": "진딧물", "symptom": "잎에 작은 벌레가 붙어 있어요", "treatment": "물로 씻어내고 통풍을 좋게 해주세요"},
            {"name": "흰가루병", "symptom": "잎에 하얀 가루가 생겨요", "treatment": "병든 잎을 제거하고 햇볕이 잘 드는 곳에 두세요"}
        ],
        "belief_check": {
            "myth": f"{clean_name}은(는) 물을 많이 줄수록 더 잘 자란다!",
            "verdict": False,
            "true_percent": 35,
            "false_percent": 65,
            "summary": "AI 분석 결과: 이 상식은 대체로 사실이 아니에요! 식물마다 알맞은 물주기가 다르답니다."
        },
        "ai_generated": 0
    }



# API Routes
@app.get("/", response_class=HTMLResponse)
async def read_root(request: Request):
    return templates.TemplateResponse(request=request, name="index.html", context={})

@app.post("/api/search")
async def search_plant(payload: SearchRequest, request: Request):
    plant_name = payload.name.strip()
    if not plant_name:
        raise HTTPException(status_code=400, detail="식물 이름을 입력해 주세요.")

    if looks_like_non_plant(plant_name):
        return {"status": "guardrail", "message": GUARDRAIL_MESSAGE}

    # 검색어 정규화 (별칭 → 표준 키)
    norm_name = _normalize_plant_name(plant_name)

    plant_data = PLANT_CACHE.get(norm_name) if not payload.force_refresh else None
    if plant_data is None:
        dir_row = _lookup_directory(norm_name)
        if dir_row is not None:
            plant_data = dict(PRESET_PLANTS.get(norm_name) or generate_fallback_plant_data(norm_name))
            plant_data["scientific_name"] = dir_row.get("scientific_name") or plant_data.get("scientific_name", "")
            plant_data["belief_check"] = {
                "myth": dir_row.get("myth") or plant_data.get("belief_check", {}).get("myth", ""),
                "verdict": bool(dir_row.get("verdict")),
                "true_percent": int(dir_row.get("true_percent") or 50),
                "false_percent": int(dir_row.get("false_percent") or 50),
                "summary": dir_row.get("belief_summary") or dir_row.get("myth") or "",
            }
            plant_data["purchase_url"] = dir_row.get("purchase_url") or DEFAULT_PURCHASE_URL
            plant_data["ai_generated"] = 0
            plant_data["directory_source"] = True
        else:
            try:
                plant_data = await asyncio.to_thread(generate_plant_with_gemini, plant_name)
            except Exception as e:
                logger.warning(f"Gemini call raised {type(e).__name__}: {e}. Falling back to static data.")
                plant_data = None
            if plant_data is not None and plant_data.get("is_plant") is False:
                return {"status": "guardrail", "message": GUARDRAIL_MESSAGE}
            if not plant_data:
                logger.info(f"모든 Gemini 모델 실패 또는 미지원 식물 '{plant_name}' - 폴백 데이터 생성")
                plant_data = generate_fallback_plant_data(norm_name)
            # 폴백에서도 비식물로 판정되면 차단
            if plant_data is not None and plant_data.get("is_plant") is False:
                return {"status": "guardrail", "message": GUARDRAIL_MESSAGE}
            # 캐시에 저장 (최대 200개, 이후 FIFO 제거)
            if len(PLANT_CACHE) >= 200:
                PLANT_CACHE.pop(next(iter(PLANT_CACHE)))
            PLANT_CACHE[norm_name] = plant_data

    # 도감 저장은 사용자가 명시적으로 선택할 때만 수행 (별도 API로 분리)

    if plant_data.get("directory_source"):
        source = "plant_directory"
    else:
        source = "gemini_ai" if plant_data.get("ai_generated") == 1 else "knowledge_base"
    return {"status": "success", "source": source, "data": _serialize_plant(plant_data)}



@app.post("/api/history/save")
async def save_to_history(payload: SaveToHistoryRequest, request: Request):
    user = _get_current_user_or_fallback(request)
    plant_data = {
        "name": payload.name,
        "scientific_name": payload.scientific_name,
        "emoji": payload.emoji,
        "belief_check": {
            "true_percent": payload.true_percent,
            "false_percent": payload.false_percent,
        },
    }
    try:
        _insert_plant_history(user["token"], user["id"], plant_data)
    except Exception as e:
        logger.error("plant_history save failed for user %s: %s", user["id"], e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"도감 저장에 실패했습니다: {e}")
    return {"status": "success", "message": f"{payload.name}이(가) 도감에 저장되었습니다!"}

@app.post("/api/auth/register")
async def auth_register(payload: AuthRequest):
    _require_supabase()
    try:
        res = sb_client.auth.sign_up({"email": payload.email, "password": payload.password})
        user = res.user
        if not user:
            raise HTTPException(status_code=400, detail="회원가입에 실패했습니다. (이메일 확인이 필요할 수 있어요)")
        
        # 세션이 있으면 바로 로그인 처리, 없으면 이메일 확인 필요 안내
        if res.session and res.session.access_token:
            return {
                "status": "success",
                "access_token": res.session.access_token,
                "user": {"id": user.id, "email": user.email},
                "message": "회원가입 완료! 자동으로 로그인되었습니다."
            }
        else:
            return {
                "status": "email_confirm_required",
                "message": "회원가입 완료! 이메일 인증 메일을 확인해 주세요. 인증 후 로그인 가능합니다.",
                "user": {"id": user.id, "email": user.email}
            }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/auth/login")
async def auth_login(payload: AuthRequest):
    _require_supabase()
    try:
        res = sb_client.auth.sign_in_with_password({"email": payload.email, "password": payload.password})
        return {
            "status": "success",
            "access_token": res.session.access_token,
            "user": {"id": res.user.id, "email": res.user.email},
        }
    except Exception:
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")

@app.get("/api/auth/me")
async def auth_me(request: Request):
    user = _get_current_user(request)
    return {"status": "success", "user": {"id": user["id"], "email": user["email"]}}

@app.post("/api/auth/logout")
async def auth_logout():
    if sb_client is not None:
        try:
            sb_client.auth.sign_out()
        except Exception:
            pass
    return {"status": "success"}

@app.get("/api/auth/oauth/google")
async def oauth_google(redirect_to: Optional[str] = None):
    if not SUPABASE_URL:
        return JSONResponse(
            status_code=503,
            content={"status": "error", "message": "Supabase가 설정되지 않았습니다."}
        )
    target = redirect_to or "http://localhost:8000"
    authorize_url = f"{SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to={target}"

    # Supabase Provider 활성화 여부 사전 검사
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.get(authorize_url, follow_redirects=False)
            if resp.status_code == 400:
                body = resp.json()
                if "provider is not enabled" in body.get("msg", "").lower():
                    return JSONResponse(
                        content={
                            "status": "provider_not_enabled",
                            "message": "Supabase 대시보드에 Google OAuth Provider가 아직 활성화되지 않았습니다. 관리자에게 문의하세요.",
                        }
                    )
            return JSONResponse(content={"status": "ok", "url": authorize_url})
    except Exception:
        return JSONResponse(content={"status": "ok", "url": authorize_url})

@app.post("/api/auth/google-quick")
async def google_quick_login():
    """개발 모드에서만 사용 가능한 빠른 구글 로그인 (공유 계정)."""
    if not DEV_MODE:
        raise HTTPException(
            status_code=403,
            detail="개발 모드에서만 사용 가능합니다. DEV_MODE=true 환경변수 설정 필요."
        )
    email = "google.user@gmail.com"
    pwd = "GooglePass2026!#"
    token = None
    user_id = None
    if sb_client is not None:
        try:
            try:
                res = sb_client.auth.sign_in_with_password({"email": email, "password": pwd})
            except Exception:
                try:
                    sb_client.auth.sign_up({"email": email, "password": pwd})
                except Exception:
                    pass
                res = sb_client.auth.sign_in_with_password({"email": email, "password": pwd})
            token = res.session.access_token
            user_id = res.user.id
        except Exception as e:
            logger.warning("google-quick login fallback to demo: %s", e)
            token = "demo-google-token"
            user_id = "google-demo-uid"
    else:
        token = "demo-google-token"
        user_id = "google-demo-uid"

    prof = _ensure_profile(token, user_id, email)
    return {
        "status": "success",
        "access_token": token,
        "user": {"id": user_id, "email": email},
        "profile": prof,
    }

@app.get("/api/profile/me")
async def get_my_profile(request: Request):
    user = _get_current_user_or_fallback(request)
    profile = _ensure_profile(user["token"], user["id"], user.get("email", ""))
    return {"status": "success", "data": profile}

@app.patch("/api/profile/me")
async def update_my_profile(payload: ProfileUpdateRequest, request: Request):
    user = _get_current_user_or_fallback(request)
    updates = {}
    if payload.nickname is not None:
        clean_nick = payload.nickname.strip()
        if not clean_nick:
            raise HTTPException(status_code=400, detail="닉네임을 입력해 주세요.")
        if len(clean_nick) > 20:
            raise HTTPException(status_code=400, detail="닉네임은 20자 이내여야 합니다.")
        updates["nickname"] = clean_nick
    if payload.avatar_emoji is not None:
        clean_avatar = payload.avatar_emoji.strip()
        if not clean_avatar:
            clean_avatar = "🌱"
        updates["avatar_emoji"] = clean_avatar

    profile = _update_profile(user["token"], user["id"], updates)
    return {"status": "success", "message": "프로필이 수정되었습니다.", "data": profile}

@app.post("/api/streak/checkin")
async def post_streak_checkin(request: Request):
    user = _get_current_user_or_fallback(request)
    result = _do_streak_checkin(user["token"], user["id"])
    return result


@app.post("/api/shop/buy")
async def post_shop_buy(payload: BuyItemRequest, request: Request):
    user = _get_current_user_or_fallback(request)
    prof = _ensure_profile(user["token"], user["id"])
    if prof.get("leaf_balance", 0) < payload.price:
        raise HTTPException(status_code=400, detail="리프가 부족합니다.")
    
    # 리프 차감 트랜잭션 기록
    new_balance = _add_leaf_transaction(user["token"], user["id"], -payload.price, f"buy_item:{payload.item_id}")
    
    # 아바타 변경
    updated_prof = _update_profile(user["token"], user["id"], {"avatar_emoji": payload.emoji})
    
    return {
        "status": "success", 
        "message": "구매 완료", 
        "new_balance": new_balance,
        "profile": updated_prof
    }


# ===================== 물주기 스케줄 API =====================
@app.get("/api/watering/schedules")
async def get_watering_schedules(request: Request):
    user = _get_current_user_or_fallback(request)
    schedules = _get_watering_schedules(user["token"], user["id"])
    return {"status": "success", "total": len(schedules), "data": schedules}


@app.post("/api/watering/schedules")
async def create_watering_schedule(payload: WateringScheduleCreate, request: Request):
    user = _get_current_user_or_fallback(request)
    schedule = _ensure_watering_schedule(
        user["token"], user["id"], payload.plant_name, payload.emoji, payload.watering_interval_days
    )
    if payload.notification_enabled is not None:
        _update_watering_schedule(user["token"], user["id"], payload.plant_name, {"notification_enabled": payload.notification_enabled})
    return {"status": "success", "message": "물주기 일정이 생성되었습니다.", "data": schedule}


@app.patch("/api/watering/schedules/{plant_name}")
async def update_watering_schedule(plant_name: str, payload: WateringScheduleUpdate, request: Request):
    user = _get_current_user_or_fallback(request)
    updates = {}
    if payload.watering_interval_days is not None:
        updates["watering_interval_days"] = payload.watering_interval_days
    if payload.next_water_date is not None:
        updates["next_water_date"] = payload.next_water_date
    if payload.notification_enabled is not None:
        updates["notification_enabled"] = payload.notification_enabled
    if payload.last_watered_at is not None:
        updates["last_watered_at"] = payload.last_watered_at
    schedule = _update_watering_schedule(user["token"], user["id"], plant_name, updates)
    if not schedule:
        raise HTTPException(status_code=404, detail="수정할 물주기 일정을 찾을 수 없습니다.")
    return {"status": "success", "message": "물주기 일정이 수정되었습니다.", "data": schedule}


@app.delete("/api/watering/schedules/{plant_name}")
async def delete_watering_schedule(plant_name: str, request: Request):
    user = _get_current_user_or_fallback(request)
    deleted = _delete_watering_schedule(user["token"], user["id"], plant_name)
    if not deleted:
        raise HTTPException(status_code=404, detail="삭제할 물주기 일정을 찾을 수 없습니다.")
    return {"status": "success", "message": "물주기 일정이 삭제되었습니다."}


@app.post("/api/watering/schedules/{plant_name}/watered")
async def mark_watered(plant_name: str, request: Request):
    user = _get_current_user_or_fallback(request)
    # 기존 스케줄이 있는지 확인 후 업데이트
    schedule = _update_watering_schedule(user["token"], user["id"], plant_name, {})
    if not schedule:
        raise HTTPException(status_code=404, detail="물주기 일정을 찾을 수 없습니다. 먼저 일정을 추가해 주세요.")
    updated = _mark_watered(user["token"], user["id"], plant_name)
    return {"status": "success", "message": f"{plant_name} 물주기 완료! 다음 물주기일 갱신됨.", "data": updated}


@app.get("/api/leaf/history")
async def get_leaf_history(request: Request):
    user = _get_current_user_or_fallback(request)
    if sb_client is not None:
        try:
            res = _user_client(user["token"]).table("leaf_transactions").select("*").eq("user_id", user["id"]).execute()
            rows = list(res.data or [])
            rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        except Exception:
            rows = []
    else:
        rows = list(MEMORY_LEAF_TX.get(user["id"], []))
        rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
    return {"status": "success", "total": len(rows), "data": rows}

@app.get("/api/history")
async def get_plant_history(request: Request):
    user = _get_current_user_or_fallback(request)
    if sb_client is not None:
        try:
            res = _user_client(user["token"]).table("plant_history").select("*").eq("user_id", user["id"]).execute()
            rows = list(res.data or [])
            rows.sort(key=lambda r: str(r.get("created_at") or ""), reverse=True)
        except Exception as e:
            logger.warning("Supabase plant_history read failed, using memory: %s", e)
            rows = _get_memory_history(user["id"])
    else:
        rows = _get_memory_history(user["id"])
    return {"status": "success", "total": len(rows), "data": rows}

@app.delete("/api/history/{row_id}")
async def delete_plant_history(row_id: str, request: Request):
    user = _get_current_user_or_fallback(request)
    if sb_client is not None:
        try:
            res = _user_client(user["token"]).table("plant_history").delete().eq("id", row_id).eq("user_id", user["id"]).execute()
            if not (res.data or []):
                raise HTTPException(status_code=404, detail="삭제할 대상을 찾을 수 없습니다.")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning("Supabase plant_history delete failed, using memory: %s", e)
            if not _delete_memory_history(user["id"], row_id):
                raise HTTPException(status_code=404, detail="삭제할 대상을 찾을 수 없습니다.")
    else:
        if not _delete_memory_history(user["id"], row_id):
            raise HTTPException(status_code=404, detail="삭제할 대상을 찾을 수 없습니다.")
    return {"status": "success", "message": "삭제되었습니다."}

@app.get("/api/popular")
async def get_popular_plants():
    data = [_serialize_plant(d) for d in PRESET_PLANTS.values()]
    return {"status": "success", "data": data}

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "database": "supabase" if sb_client is not None else "unconfigured",
        "supabase_connected": sb_client is not None,
        "timestamp": datetime.now().isoformat(),
    }

@app.get("/api/status")
async def api_status():
    return {
        "ai_enabled": bool(os.environ.get("GEMINI_API_KEY")),
        "model": GEMINI_MODEL_CANDIDATES[0],
        "supabase_connected": sb_client is not None,
        "version": "2.0.0",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
# Trigger reload
