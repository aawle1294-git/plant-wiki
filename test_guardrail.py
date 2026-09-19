# -*- coding: utf-8 -*-
"""식물 가드레일(비식물 검색어 차단) 검증 테스트.

계약:
- 비식물 검색어(강아지, 자동차 등) → POST /api/search 응답이
  {"status": "guardrail", "message": "Plant!p은 식물 탐구를 위한 공간이에요! 🌱"} 이어야 한다.
- 식물/미지식물은 기존 success 흐름을 유지한다(과잉 차단 금지).
- 빈 입력은 400 유지.
"""

from fastapi.testclient import TestClient
from app import app

client = TestClient(app)

GUARDRAIL_MSG = "Plant!p은 식물 탐구를 위한 공간이에요! 🌱"


def test_guardrail_korean_non_plant_dog():
    r = client.post("/api/search", json={"name": "강아지"})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "guardrail"
    assert body["message"] == GUARDRAIL_MSG


def test_guardrail_korean_non_plant_car():
    r = client.post("/api/search", json={"name": "자동차"})
    assert r.status_code == 200
    assert r.json()["status"] == "guardrail"
    assert r.json()["message"] == GUARDRAIL_MSG


def test_guardrail_english_non_plant():
    r = client.post("/api/search", json={"name": "dog"})
    assert r.status_code == 200
    assert r.json()["status"] == "guardrail"


def test_normal_plants_not_guardrailed():
    for name in ["토마토", "몬스테라", "바질"]:
        r = client.post("/api/search", json={"name": name})
        assert r.status_code == 200
        body = r.json()
        assert body["status"] == "success", f"{name}: 가드레일 오차단"
        assert body["data"]["belief_check"]["true_percent"] + body["data"]["belief_check"]["false_percent"] == 100


def test_unknown_plant_still_fallback_success():
    # 미지식물(키위나무)은 가드레일이 아니라 일반 폴백으로 처리되어야 한다
    r = client.post("/api/search", json={"name": "키위나무"})
    assert r.status_code == 200
    assert r.json()["status"] == "success"


def test_empty_input_still_400():
    r = client.post("/api/search", json={"name": "   "})
    assert r.status_code == 400