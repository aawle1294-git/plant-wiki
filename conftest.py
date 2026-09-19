# -*- coding: utf-8 -*-
"""pytest 공용 픽스처.

- 외부 Gemini API 의존성 제거 (기존과 동일)
- 외부 Supabase 클라우드 의존성 제거: 인메모리 FakeSupabase로 교체
  (auth sign_up/sign_in_with_password/get_user + table insert/select/delete/eq)
"""

import pytest
import app as app_module
from types import SimpleNamespace


class _FakeStore:
    def __init__(self):
        self.rows = []
        self.tables = {}
        self.users = {}
        self.next_id = 1

    def get_table(self, name):
        if name in ("plant_history", "plant_directory"):
            return self.rows
        if name == "plant_watering_schedules":
            if name not in self.tables:
                self.tables[name] = []
            return self.tables[name]
        if name not in self.tables:
            self.tables[name] = []
        return self.tables[name]

    def new_id(self):
        i = self.next_id
        self.next_id += 1
        return str(i)


class _FakeAuth:
    def __init__(self, store):
        self.store = store

    def sign_up(self, credentials):
        email = credentials["email"]
        password = credentials["password"]
        if email in self.store.users:
            raise Exception("User already registered")
        uid = self.store.new_id()
        self.store.users[email] = {
            "password": password,
            "id": uid,
            "token": f"token-{email}",
        }
        return SimpleNamespace(user=SimpleNamespace(id=uid, email=email))

    def sign_in_with_password(self, credentials):
        email = credentials["email"]
        password = credentials["password"]
        u = self.store.users.get(email)
        if not u or u["password"] != password:
            raise Exception("Invalid login credentials")
        return SimpleNamespace(
            user=SimpleNamespace(id=u["id"], email=email),
            session=SimpleNamespace(access_token=u["token"]),
        )

    def get_user(self, jwt=None):
        if not jwt:
            return None
        for email, u in self.store.users.items():
            if u["token"] == jwt:
                return SimpleNamespace(user=SimpleNamespace(id=u["id"], email=email))
        return None


class _FakeBuilder:
    def __init__(self, store, table_name="plant_history"):
        self.store = store
        self.table_name = table_name
        self.filters = []
        self.op = None
        self.payload = None

    def insert(self, rows):
        self.op = "insert"
        self.payload = rows
        return self

    def update(self, values):
        self.op = "update"
        self.payload = values
        return self

    def delete(self):
        self.op = "delete"
        return self

    def select(self, *cols):
        self.op = "select"
        self.payload = cols
        return self

    def eq(self, col, val):
        self.filters.append((col, val))
        return self

    def execute(self):
        table = self.store.get_table(self.table_name)
        matched = table
        for col, val in self.filters:
            matched = [r for r in matched if r.get(col) == val]

        if self.op == "insert":
            payloads = self.payload if isinstance(self.payload, list) else [self.payload]
            inserted = []
            for p in payloads:
                row = dict(p)
                row.setdefault("id", self.store.new_id())
                row.setdefault("created_at", "2026-08-15T00:00:00")
                table.append(row)
                inserted.append(row)
            return SimpleNamespace(data=inserted, error=None)

        if self.op == "update":
            updates = dict(self.payload)
            updated = []
            for r in matched:
                r.update(updates)
                updated.append(r)
            return SimpleNamespace(data=updated, error=None)

        if self.op == "delete":
            table[:] = [r for r in table if r not in matched]
            return SimpleNamespace(data=matched, error=None)

        return SimpleNamespace(data=matched, error=None)


class FakeSupabase:
    def __init__(self):
        self.store = _FakeStore()
        self.auth = _FakeAuth(self.store)

    def table(self, name):
        return _FakeBuilder(self.store, name)


@pytest.fixture(autouse=True)
def fake_sb(monkeypatch):
    monkeypatch.setattr(app_module, "generate_plant_with_gemini", lambda plant_name: None)
    fake = FakeSupabase()
    monkeypatch.setattr(app_module, "sb_client", fake, raising=False)
    monkeypatch.setattr(app_module, "_user_client", lambda token: fake, raising=False)
    return fake
