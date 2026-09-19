# -*- coding: utf-8 -*-
"""와이어 통합 테스트 — 실제 supabase-py 클라이언트 + 로컬 모의 Supabase HTTP 서버 + 실제 app 라우트.

conftest의 FakeSupabase는 create_client/auth/postgrest.auth를 모듈 레벨에서 우회하므로
실제 supabase-py의 와이어 프로토콜(경로·헤더·페이로드·응답 형태)은 검증되지 않는다.
이 파일은 모의 Supabase HTTP 서버(auth/v1 + rest/v1 하위집합)를 로컬 포트에 띄우고
실제 create_client → 실제 auth 호출 → 실제 postgrest.auth → 실제 table().insert/select/delete
를 HTTP로 구동해, 실클라우드 E2E 이전에 와이어 계층의 리스크를 제거한다.
"""

import threading
import time
from datetime import datetime
from typing import Dict, List

import pytest
import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.testclient import TestClient
from supabase import create_client

import app as app_module

WIRE_PORT = 8137
WIRE_BASE = f"http://127.0.0.1:{WIRE_PORT}"


def make_mock_app():
    """Supabase Auth + PostgREST(plant_history) 하위집합 모의 서버와 상태 저장소를 생성한다."""
    store = {"users": {}, "rows": [], "directory": [dict(r) for r in app_module.PLANT_DIRECTORY_SEED], "next_id": 1}
    mock = FastAPI()

    def new_id() -> str:
        i = store["next_id"]
        store["next_id"] += 1
        return str(i)

    def user_payload(u: dict) -> dict:
        # supabase-py 2.31 User 모델 필수 필드: id/aud/role/email/app_metadata/user_metadata/created_at
        return {
            "id": u["id"],
            "aud": "authenticated",
            "role": "authenticated",
            "email": u["email"],
            "app_metadata": {"provider": "email", "providers": ["email"]},
            "user_metadata": {},
            "created_at": datetime.utcnow().isoformat(),
        }

    def find_by_token(token: str):
        for u in store["users"].values():
            if u["token"] == token:
                return u
        return None

    @mock.post("/auth/v1/signup")
    async def signup(request: Request):
        body = await request.json()
        email = body.get("email", "")
        if email in store["users"]:
            raise HTTPException(status_code=400, detail="User already registered")
        uid = new_id()
        store["users"][email] = {"id": uid, "email": email, "password": body.get("password", ""), "token": f"tok-{uid}"}
        return user_payload(store["users"][email])

    @mock.post("/auth/v1/token")
    async def token(request: Request, grant_type: str = "password"):
        body = await request.json()
        u = store["users"].get(body.get("email", ""))
        if not u or u["password"] != body.get("password"):
            raise HTTPException(status_code=400, detail="Invalid login credentials")
        return {
            "access_token": u["token"],
            "token_type": "bearer",
            "expires_in": 3600,
            "refresh_token": f"ref-{u['id']}",
            "user": user_payload(u),
        }

    @mock.get("/auth/v1/user")
    async def get_user(request: Request):
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="invalid jwt")
        u = find_by_token(auth[len("Bearer "):].strip())
        if not u:
            raise HTTPException(status_code=401, detail="invalid jwt")
        return user_payload(u)

    @mock.post("/auth/v1/logout")
    async def logout():
        return Response(status_code=204)

    def parse_eq(params) -> Dict[str, str]:
        out = {}
        for k, v in params.items():
            if str(v).startswith("eq."):
                out[k] = str(v)[3:]
        return out

    @mock.get("/rest/v1/plant_history")
    async def rest_select(request: Request):
        filters = parse_eq(dict(request.query_params))
        rows = store["rows"]
        for k, v in filters.items():
            rows = [r for r in rows if str(r.get(k)) == str(v)]
        return rows

    @mock.get("/rest/v1/plant_directory")
    async def rest_directory(request: Request):
        filters = parse_eq(dict(request.query_params))
        rows = store["directory"]
        for k, v in filters.items():
            rows = [r for r in rows if str(r.get(k)) == str(v)]
        return rows

    @mock.post("/rest/v1/plant_history")
    async def rest_insert(request: Request):
        body = await request.json()
        payloads = body if isinstance(body, list) else [body]
        inserted: List[dict] = []
        for p in payloads:
            row = dict(p)
            row.setdefault("id", new_id())
            row.setdefault("created_at", datetime.utcnow().isoformat())
            store["rows"].append(row)
            inserted.append(row)
        return inserted

    @mock.delete("/rest/v1/plant_history")
    async def rest_delete(request: Request):
        filters = parse_eq(dict(request.query_params))
        deleted, keep = [], []
        for r in store["rows"]:
            if all(str(r.get(k)) == str(v) for k, v in filters.items()):
                deleted.append(r)
            else:
                keep.append(r)
        store["rows"] = keep
        return deleted

    return mock, store


@pytest.fixture(scope="module")
def wire_server():
    mock, store = make_mock_app()
    server = uvicorn.Server(uvicorn.Config(mock, host="127.0.0.1", port=WIRE_PORT, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.time() + 10
    while not server.started and time.time() < deadline:
        time.sleep(0.05)
    assert server.started, "모의 Supabase 서버 기동 실패"
    yield store
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture
def wire_app(monkeypatch, wire_server):
    """실제 supabase-py 클라이언트를 모의 서버에 바인딩해 app 라우트를 와이어로 구동한다."""

    def make_user_client(token: str):
        c = create_client(WIRE_BASE, "test-key")
        c.postgrest.auth(token)
        return c

    monkeypatch.setattr(app_module, "generate_plant_with_gemini", lambda name: None)
    monkeypatch.setattr(app_module, "sb_client", create_client(WIRE_BASE, "test-key"))
    monkeypatch.setattr(app_module, "_user_client", make_user_client)
    return wire_server


def _register(client: TestClient, email: str, pw: str = "pw123456"):
    r = client.post("/api/auth/register", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["user"]["id"]


def _login(client: TestClient, email: str, pw: str = "pw123456"):
    r = client.post("/api/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_wire_full_pipeline_register_login_search_insert_select_delete(wire_app):
    """실제 와이어로 회원가입→로그인→검색(Insert)→도감(Select)→삭제 전체 흐름 검증."""
    client = TestClient(app_module.app)
    uid = _register(client, "wire-flow@test.com")
    token = _login(client, "wire-flow@test.com")

    me = client.get("/api/auth/me", headers=_auth(token))
    assert me.status_code == 200 and me.json()["user"]["email"] == "wire-flow@test.com"

    search = client.post("/api/search", json={"name": "토마토"}, headers=_auth(token))
    assert search.status_code == 200
    assert search.json()["status"] == "success"
    assert search.json()["data"]["name"] == "토마토"

    history = client.get("/api/history", headers=_auth(token))
    assert history.status_code == 200
    body = history.json()
    assert body["total"] == 1, body
    row = body["data"][0]
    assert row["plant_name"] == "토마토"
    assert row["scientific_name"] == "Solanum lycopersicum"
    assert row["true_percent"] == 30 and row["false_percent"] == 70
    assert row["user_id"] == uid
    assert row["id"] and row["created_at"]

    deleted = client.delete(f"/api/history/{row['id']}", headers=_auth(token))
    assert deleted.status_code == 200

    empty = client.get("/api/history", headers=_auth(token))
    assert empty.json()["total"] == 0


def test_wire_user_scoping_select_own_rows_only(wire_app):
    """유저 A의 검색 기록이 유저 B의 도감에 나타나지 않는지 와이어로 검증."""
    client = TestClient(app_module.app)
    _register(client, "wire-a@test.com")
    _register(client, "wire-b@test.com")
    token_a = _login(client, "wire-a@test.com")
    token_b = _login(client, "wire-b@test.com")

    client.post("/api/search", json={"name": "토마토"}, headers=_auth(token_a))

    b_history = client.get("/api/history", headers=_auth(token_b))
    assert b_history.json()["total"] == 0

    a_history = client.get("/api/history", headers=_auth(token_a))
    assert a_history.json()["total"] == 1

    # A가 B의 행을 삭제 시도 → 404 (유저스코프 삭제)
    row_id = a_history.json()["data"][0]["id"]
    wrong_delete = client.delete(f"/api/history/{row_id}", headers=_auth(token_b))
    assert wrong_delete.status_code == 404


def test_wire_guardrail_does_not_insert(wire_app):
    """가드레일 검색어는 로그인 상태여도 Insert하지 않는지 와이어로 검증."""
    client = TestClient(app_module.app)
    _register(client, "wire-guard@test.com")
    token = _login(client, "wire-guard@test.com")

    r = client.post("/api/search", json={"name": "강아지"}, headers=_auth(token))
    assert r.status_code == 200 and r.json()["status"] == "guardrail"

    history = client.get("/api/history", headers=_auth(token))
    assert history.json()["total"] == 0


def test_wire_auth_errors(wire_app):
    """잘못된 비밀번호/토큰 부재 시 401, 미로그인 검색은 성공(무삽입)인지 와이어로 검증."""
    client = TestClient(app_module.app)
    _register(client, "wire-err@test.com")

    bad_login = client.post("/api/auth/login", json={"email": "wire-err@test.com", "password": "wrongpw"})
    assert bad_login.status_code == 401

    no_token_me = client.get("/api/auth/me")
    assert no_token_me.status_code == 401

    no_token_history = client.get("/api/history")
    assert no_token_history.status_code == 401

    anon_search = client.post("/api/search", json={"name": "토마토"})
    assert anon_search.status_code == 200 and anon_search.json()["status"] == "success"


def test_wire_plant_directory_search(wire_app):
    """실제 와이어로 plant_directory 1차 조회 + 딥링크 구매 URL을 검증한다."""
    client = TestClient(app_module.app)

    search = client.post("/api/search", json={"name": "방울토마토"})
    assert search.status_code == 200
    body = search.json()
    assert body["source"] == "plant_directory"
    assert body["data"]["scientific_name"] == "Solanum lycopersicum var. cerasiforme"
    assert body["data"]["belief_check"]["true_percent"] == 25
    assert body["data"]["purchase_url"] == "https://www.daisomall.co.kr/pd/pdr/SCR_PDR_0001?pdNo=1013554&recmYn=N"

    unknown = client.post("/api/search", json={"name": "민트"})
    assert unknown.status_code == 200
    assert unknown.json()["source"] != "plant_directory"
    assert unknown.json()["data"]["purchase_url"] == "https://www.asiaseedmall.com/goods/goods_search.php?keyword=민트"