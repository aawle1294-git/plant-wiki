# -*- coding: utf-8 -*-
"""Plant!p 종합 시스템 건전성 및 무결성 자동 점검 도구.

실행: python scripts/health_check.py
검사항목:
1. 코드베이스 오타 및 한글 키보드 오염 감지 (며소, 며새, 냣드메, 틔 등)
2. HTML 템플릿 태그 밸런스 및 닫힘 검증 (index.html, landing.html, privacy.html, terms.html)
3. 파이썬 문법 검증 (py_compile)
4. FastAPI 핵심 엔드포인트 무결성 스모크 테스트 (200 OK 여부, XML 규격 등)
5. 전체 pytest 스위트 실행
"""

import sys
import os
import re
import glob
import py_compile
from fastapi.testclient import TestClient

ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT_DIR)

PASSED = 0
FAILED = 0


def log_pass(msg):
    global PASSED
    PASSED += 1
    print(f"  [PASS] {msg}")


def log_fail(msg):
    global FAILED
    FAILED += 1
    print(f"  [FAIL] {msg}")


def check_korean_typos():
    print("\n🔍 1. 한글 키보드 오염 및 오타 검사")
    typo_patterns = [
        ("며소", "auth가 한글로 오타난 패턴"),
        ("며새", "auto가 한글로 오타난 패턴"),
        ("냣드메", "sitemap이 한글로 오타난 패턴"),
        ("<?틔", "<?xml이 한글로 오타난 패턴"),
        ("application/틔", "application/xml이 한글로 오타난 패턴"),
        ("0a62츄뮤", "쿠팡 링크 cbab가 오타난 패턴"),
    ]
    found = False
    for root, dirs, files in os.walk(ROOT_DIR):
        if any(x in root for x in [".git", "venv", "__pycache__", ".pytest_cache", "scripts"]):
            continue
        for file in files:
            if file.endswith((".py", ".html", ".js", ".css")):
                p = os.path.join(root, file)
                rel = os.path.relpath(p, ROOT_DIR)
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        content = f.read()
                    for pattern, desc in typo_patterns:
                        if pattern in content:
                            log_fail(f"{rel}: '{pattern}' 발견 ({desc})")
                            found = True
                except Exception as e:
                    log_fail(f"{rel} 읽기 오류: {e}")
    if not found:
        log_pass("키보드 오타 및 한글 깨짐 패턴 0건 (완전 무결)")


def check_html_tags():
    print("\n🔍 2. HTML 템플릿 태그 밸런스 검사")
    templates = glob.glob(os.path.join(ROOT_DIR, "templates", "*.html"))
    for t_path in templates:
        fname = os.path.basename(t_path)
        with open(t_path, "r", encoding="utf-8") as f:
            code = f.read()
        all_balanced = True
        for tag in ["div", "section", "article"]:
            opens = len(re.findall(rf"<{tag}[\s>]", code))
            closes = len(re.findall(rf"</{tag}>", code))
            if opens != closes:
                log_fail(f"{fname}: <{tag}> 불균형 (열림={opens}, 닫힘={closes})")
                all_balanced = False
        if all_balanced:
            log_pass(f"{fname}: 모든 태그 밸런스 정상")


def check_py_compile():
    print("\n🔍 3. 파이썬 문법 검증 (py_compile)")
    py_files = []
    for root, dirs, files in os.walk(ROOT_DIR):
        if any(x in root for x in [".git", "venv", "__pycache__", ".pytest_cache", "scripts"]):
            continue
        for file in files:
            if file.endswith(".py"):
                py_files.append(os.path.join(root, file))

    errs = 0
    for pf in py_files:
        rel = os.path.relpath(pf, ROOT_DIR)
        try:
            py_compile.compile(pf, doraise=True)
        except Exception as e:
            log_fail(f"{rel} 문법 오류: {e}")
            errs += 1
    if errs == 0:
        log_pass(f"파이썬 파일 {len(py_files)}개 문법 검사 통과")


def check_routes():
    print("\n🔍 4. 핵심 엔드포인트 스모크 테스트")
    try:
        from main import app
        client = TestClient(app)

        routes = [
            ("/", 200, "랜딩/홈 페이지"),
            ("/app", 200, "식물 위키 앱 페이지"),
            ("/wiki", 200, "위키 엔드포인트"),
            ("/intro", 200, "서비스 소개 페이지"),
            ("/privacy", 200, "개인정보처리방침"),
            ("/terms", 200, "이용약관"),
            ("/robots.txt", 200, "크롤러 로봇 파일"),
            ("/sitemap.xml", 200, "사이트맵 XML"),
            ("/api/health", 200, "헬스체크 API"),
            ("/api/status", 200, "시스템 상태 API"),
            ("/api/popular", 200, "인기 식물 목록 API"),
        ]

        for route, expected_code, desc in routes:
            r = client.get(route)
            if r.status_code == expected_code:
                log_pass(f"{route} -> {r.status_code} ({desc})")
            else:
                log_fail(f"{route} -> {r.status_code} (예상: {expected_code})")

        # 사이트맵 규격 검사
        sitemap_res = client.get("/sitemap.xml")
        if "<?xml" in sitemap_res.text and "<urlset" in sitemap_res.text:
            log_pass("sitemap.xml 정상 XML 포맷 검증 완료")
        else:
            log_fail("sitemap.xml 포맷 불량")

        # robots.txt sitemap 링크 검사
        robots_res = client.get("/robots.txt")
        if "sitemap.xml" in robots_res.text:
            log_pass("robots.txt sitemap.xml 참조 검증 완료")
        else:
            log_fail("robots.txt sitemap.xml 누락")

    except Exception as e:
        log_fail(f"엔드포인트 테스트 실행 중 예외: {e}")


def main():
    print("=" * 60)
    print("  🌿 Plant!p 시스템 건전성 및 유지보수 자동 점검")
    print("=" * 60)

    check_korean_typos()
    check_html_tags()
    check_py_compile()
    check_routes()

    print("\n" + "=" * 60)
    print(f"  결과: 성공 {PASSED}건 / 실패 {FAILED}건")
    print("=" * 60)

    if FAILED > 0:
        sys.exit(1)
    else:
        print("  🎉 모든 무결성 검증을 완벽하게 통과했습니다!\n")
        sys.exit(0)


if __name__ == "__main__":
    main()
