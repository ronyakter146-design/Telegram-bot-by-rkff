import asyncio
import os
import random
import string
import re
from playwright.async_api import async_playwright
from temp_mail.temp_mail import TempMail

GIZ_SIGNUP_URL = "https://www.giz.ai/signUp"
GIZ_VIDEO_URL = "https://app.giz.ai/ai-video-generator"

def _generate_password(length=12):
    chars = string.ascii_letters + string.digits + "!@#$"
    return "".join(random.choice(chars) for _ in range(length))

async def _create_temp_inbox():
    tm = TempMail()
    return tm.mailbox, tm

async def _wait_for_verification_code(tm, timeout=90):
    start_time = asyncio.get_event_loop().time()
    while asyncio.get_event_loop().time() - start_time < timeout:
        try:
            messages = tm.get_messages()
            if messages:
                for msg in messages:
                    body = msg.get('mail_text', '') or msg.get('mail_html', '')
                    match = re.search(r'\b(\d{6})\b', body)
                    if match:
                        return match.group(1)
        except Exception as e:
            print(f"[OTP] Error: {e}")
        await asyncio.sleep(5)
    return None

async def signup_giz(page, email, tm, password):
    await page.goto(GIZ_SIGNUP_URL, wait_until="networkidle")
    await page.wait_for_timeout(3000)

    # ধাপ ১: ইমেইল বসিয়ে "Continue with Email" ক্লিক
    await page.wait_for_selector('input[placeholder="you@example.com"]', timeout=10000)
    await page.fill('input[placeholder="you@example.com"]', email)
    await page.click('button:has-text("Continue with Email")')
    await page.wait_for_timeout(3000)

    # ধাপ ২: ভেরিফিকেশন কোড, নাম ও পাসওয়ার্ড
    await page.wait_for_selector('input[placeholder*="6-digit code"]', timeout=10000)
    code = await _wait_for_verification_code(tm)
    if code:
        await page.fill('input[placeholder*="6-digit code"]', code)
    else:
        await page.screenshot(path="error_screenshot.png")
        raise Exception("Verification code পাওয়া যায়নি!")

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
            email, tm = await _create_temp_inbox()
            password = _generate_password()
            print(f"[Flow] Email: {email}")
            await signup_giz(page, email, tm, password)
            video_links = await generate_videos(page, prompt, count=2)
            await logout_giz(page)
            return video_links
        finally:
            await context.close()
            await browser.close()
