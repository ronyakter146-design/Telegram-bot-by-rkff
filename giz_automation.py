import asyncio
import os
import random
import string
import re
import requests
from playwright.async_api import async_playwright

GIZ_SIGNUP_URL = "https://www.giz.ai/signUp"
GIZ_VIDEO_URL = "https://app.giz.ai/ai-video-generator"

def _generate_password(length=12):
    chars = string.ascii_letters + string.digits + "!@#$"
    return "".join(random.choice(chars) for _ in range(length))

def _create_temp_inbox():
    """mail.tm API থেকে নতুন টেম্পোরারি ইমেইল তৈরি করে।"""
    domain_res = requests.get("https://api.mail.tm/domains").json()
    domain = domain_res['hydra:member'][0]['domain']
    username = ''.join(random.choices(string.ascii_lowercase + string.digits, k=10))
    email = f"{username}@{domain}"
    password = ''.join(random.choices(string.ascii_letters + string.digits, k=12))
    
    requests.post("https://api.mail.tm/accounts", json={"address": email, "password": password})
    token_res = requests.post("https://api.mail.tm/token", json={"address": email, "password": password}).json()
    token = token_res['token']
    return email, token

def _wait_for_verification_code(token, timeout=90):
    """mail.tm API থেকে ভেরিফিকেশন কোড খুঁজে বের করে।"""
    headers = {"Authorization": f"Bearer {token}"}
    import time
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            res = requests.get("https://api.mail.tm/messages", headers=headers).json()
            if res.get('hydra:totalItems', 0) > 0:
                msg_id = res['hydra:member'][0]['id']
                msg_res = requests.get(f"https://api.mail.tm/messages/{msg_id}", headers=headers).json()
                body = msg_res.get('text', '') or msg_res.get('html', '')
                match = re.search(r'\b(\d{6})\b', str(body))
                if match:
                    return match.group(1)
        except Exception as e:
            print(f"[OTP] Error: {e}")
        time.sleep(5) # ৫ সেকেন্ড পর পর চেক করবে
    return None

async def signup_giz(page, email, token, password):
    await page.goto(GIZ_SIGNUP_URL, wait_until="networkidle")
    await page.wait_for_timeout(3000)

    # ধাপ ১: ইমেইল বসিয়ে "Continue with Email" ক্লিক
    await page.wait_for_selector('input[placeholder="you@example.com"]', timeout=10000)
    await page.fill('input[placeholder="you@example.com"]', email)
    await page.click('button:has-text("Continue with Email")')
    await page.wait_for_timeout(3000)

    # ধাপ ২: ভেরিফিকেশন কোড বক্স খোঁজা (টাইমআউট বাড়িয়ে ২০ সেকেন্ড করা হলো)
    try:
        await page.wait_for_selector('input[placeholder*="6-digit code"]', timeout=20000)
    except:
        # যদি ২০ সেকেন্ডেও না পায়, তাহলে স্ক্রিনশট তুলে রাখবে
        await page.screenshot(path="error_screenshot.png")
        raise Exception("৬ ডিজিটের কোড বক্স পাওয়া যায়নি! স্ক্রিনশট দেখুন।")

    # কোড বসানো
    code = _wait_for_verification_code(token)
    if code:
        await page.fill('input[placeholder*="6-digit code"]', code)
    else:
        await page.screenshot(path="error_screenshot.png")
        raise Exception("ইনবক্সে ভেরিফিকেশন কোড আসেনি!")

    await page.fill('input[placeholder="Your name"]', "Temp User")
    await page.fill('input[placeholder="Set password"]', password)
    await page.fill('input[placeholder="Confirm password"]', password)
    await page.click('button:has-text("Create an account")')
    await page.wait_for_timeout(5000)

async def generate_videos(page, prompt, count=2):
    results = []
    await page.goto(GIZ_VIDEO_URL, wait_until="networkidle")
    for i in range(count):
        for selector in ['textarea[placeholder*="prompt"]', 'textarea[name*="prompt"]', 'textarea']:
            try:
                await page.wait_for_selector(selector, timeout=5000)
                await page.fill(selector, prompt)
                break
            except:
                continue
        for selector in ['button:has-text("Generate")', 'button:has-text("Create")', 'button[type="submit"]']:
            try:
                await page.click(selector)
                break
            except:
                continue
        await page.wait_for_timeout(20000)
        video_elements = await page.query_selector_all('video source, video')
        if video_elements:
            src = await video_elements[0].get_attribute('src')
            if src:
                results.append(src)
        await page.reload(wait_until="networkidle")
    return results

async def logout_giz(page):
    try:
        await page.click('button[aria-label*="account"], div[class*="avatar"]', timeout=5000)
        await page.click('text=Logout, text=Sign out', timeout=5000)
    except Exception:
        await page.goto("https://app.giz.ai/api/auth/signOut", wait_until="networkidle")
    await page.wait_for_timeout(2000)

async def run_giz_flow(prompt):
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"])
        context = await browser.new_context(viewport={"width": 1280, "height": 720})
        page = await context.new_page()
        try:
            email, token = _create_temp_inbox()
            password = _generate_password()
            print(f"[Flow] Email: {email}")
            await signup_giz(page, email, token, password)
            video_links = await generate_videos(page, prompt, count=2)
            await logout_giz(page)
            return video_links
        finally:
            await context.close()
            await browser.close()
