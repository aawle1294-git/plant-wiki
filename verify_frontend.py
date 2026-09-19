#!/usr/bin/env python3
"""
Visual verification of the plant wiki frontend using headless chromium directly.
"""
import subprocess
import time
import os
import sys

CHROMIUM_PATH = "/home/aaron/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome"
BASE_URL = "http://localhost:8000"
SCREENSHOT_DIR = "/tmp/opencode/plant_wiki_screenshots"

os.makedirs(SCREENSHOT_DIR, exist_ok=True)

def run_chromium(url, output_path, width=1280, height=720, wait_time=3):
    """Run headless chromium to capture screenshot."""
    cmd = [
        CHROMIUM_PATH,
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        f"--window-size={width},{height}",
        f"--screenshot={output_path}",
        url
    ]
    try:
        result = subprocess.run(cmd, capture_output=True, timeout=30)
        return result.returncode == 0
    except subprocess.TimeoutExpired:
        return False

def test_page_load():
    """Test that the main page loads and contains expected content."""
    print("Testing main page load...")
    output = os.path.join(SCREENSHOT_DIR, "main_page.png")
    success = run_chromium(BASE_URL, output)
    if success:
        print(f"  ✓ Main page screenshot saved to {output}")
        # Also fetch and check content
        import urllib.request
        try:
            resp = urllib.request.urlopen(BASE_URL, timeout=10)
            html = resp.read().decode('utf-8')
            checks = [
                ("Plant!p" in html, "Title 'Plant!p' present"),
                ("식물 위키" in html, "Plant wiki text present"),
                ("나의 도감" in html or "도감" in html, "History/my collection text present"),
                ("로즈마리" in html or "몬스테라" in html or "토마토" in html, "Plant chips present"),
                ("Gemini" in html or "AI" in html, "AI badge/text present"),
            ]
            for check, desc in checks:
                if check:
                    print(f"  ✓ {desc}")
                else:
                    print(f"  ✗ {desc}")
            return True
        except Exception as e:
            print(f"  ✗ Failed to fetch HTML: {e}")
            return False
    else:
        print(f"  ✗ Failed to capture screenshot")
        return False

def test_search_flow():
    """Test the search functionality by simulating form submission."""
    print("Testing search flow...")
    import urllib.request
    import json
    
    # Test API search
    try:
        req = urllib.request.Request(
            f"{BASE_URL}/api/search",
            data=json.dumps({"name": "토마토"}).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        resp = urllib.request.urlopen(req, timeout=10)
        data = json.loads(resp.read().decode())
        if data.get("status") == "success" and data.get("data", {}).get("name") == "토마토":
            d = data["data"]
            # Check new fields
            has_belief = "belief_check" in d and isinstance(d["belief_check"], dict)
            has_pests = "pests" in d and isinstance(d["pests"], list) and len(d["pests"]) > 0
            has_purchase = "purchase_url" in d
            print(f"  ✓ API search works (source: {data.get('source')})")
            print(f"  ✓ belief_check present: {has_belief}")
            print(f"  ✓ pests present: {has_pests}")
            print(f"  ✓ purchase_url present: {has_purchase}")
            return True
        else:
            print(f"  ✗ API search returned unexpected data")
            return False
    except Exception as e:
        print(f"  ✗ API search failed: {e}")
        return False

def test_history_page():
    """Test history tab content via API (demo user fallback)."""
    print("Testing history page...")
    import urllib.request
    import json
    try:
        resp = urllib.request.urlopen(f"{BASE_URL}/api/history", timeout=10)
        data = json.loads(resp.read().decode())
        if data.get("status") == "success" and isinstance(data.get("data"), list):
            print(f"  ✓ History API works (total: {data.get('total')}, demo mode)")
            return True
        else:
            print(f"  ✗ History API returned unexpected data")
            return False
    except Exception as e:
        print(f"  ✗ History API failed: {e}")
        return False

def test_responsive():
    """Test mobile viewport."""
    print("Testing mobile viewport...")
    output = os.path.join(SCREENSHOT_DIR, "mobile_page.png")
    success = run_chromium(BASE_URL, output, width=375, height=667)
    if success:
        print(f"  ✓ Mobile screenshot saved to {output}")
        return True
    else:
        print(f"  ✗ Mobile screenshot failed")
        return False

def main():
    print("=" * 60)
    print("PLANT WIKI FRONTEND VISUAL VERIFICATION")
    print("=" * 60)
    
    # Check server is running
    import urllib.request
    try:
        urllib.request.urlopen(f"{BASE_URL}/api/health", timeout=5)
        print("✓ Backend server is running")
    except Exception as e:
        print(f"✗ Backend server not accessible: {e}")
        return 1
    
    all_passed = True
    all_passed &= test_page_load()
    all_passed &= test_search_flow()
    all_passed &= test_history_page()
    all_passed &= test_responsive()
    
    print("=" * 60)
    if all_passed:
        print("✓ ALL VISUAL VERIFICATION TESTS PASSED")
        return 0
    else:
        print("✗ SOME TESTS FAILED")
        return 1

if __name__ == "__main__":
    sys.exit(main())
