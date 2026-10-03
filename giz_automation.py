import asyncio
import os
import random
import string
from playwright.async_api import async_playwright
from best_tempmail import TempMail

# ⚠️ এখানে Sign Up এর লিংক দিয়েছি (আগে ভুলে Sign In ছিল)
GIZ_SIGNUP_URL = "https://app.giz.ai/signUp" 
GIZ_VIDEO_URL = "https://app.giz.ai/ai-video-generator"

_temp_mail = TempMail()

def _generate_password(length=12):
    chars = string.ascii_letters + string.digits + "!@#$"
    return "".join(random.choice(chars) for _ in range(length))

async def _create_temp_inbox():
    inbox = _temp_mail.create_inbox()
    return inbox.address

async def _wait_for_verification_code(address, timeout=60):
    try:
        otp = _temp_mail.wait_for_otp(address, timeout=timeout)
        if otp and otp.code:
            return otp.code
    except Exception as e:
        print(f"[OTP] Error: {e}")
    return None

async def signup_giz(page, email, password):
    await page.goto(GIZ_SIGNUP_URL, wait_until="networkidle")
    await page.wait_for_timeout(3000)

    # ইমেইল বক্সে টাইপ করবে (তোমার আগের ছবি অনুযায়ী placeholder)
    try:
        await page.wait_for_selector('input[placeholder="you@example.com"]', timeout=10000)
        await page.fill('input[placeholder="you@example.com"]', email)
    except:
        await page.fill('input[placeholder*="example"]', email)

    # পাসওয়ার্ড বক্সে টাইপ করবে
    await page.fill('input[placeholder="Password"]', password)

    # "Sign Up" বা "Create account" বাটনে ক্লিক করবে
    try:
        await page.click('button:has-text("Sign up")', timeout=5000)
    except:
        try:
            await page.click('button:has-text("Create account")', timeout=5000)
        except:
            await page.click('button:has-text("Continue")', timeout=5000)

    # ভেরিফিকেশন কোড এলে বসাবে
    try:
        await page.wait_for_selector('input[placeholder*="code"], input[name*="code"]', timeout=15000)
        code = await _wait_for_verification_code(email)
        if code:
            await page.fill('input[placeholder*="code"], input[name*="code"]', code)
            await page.click('button[type="submit"]')
    except Exception:
        pass

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
            email = await _create_temp_inbox()
            password = _generate_password()
            print(f"[Flow] Email: {email}")
            await signup_giz(page, email, password)
            video_links = await generate_videos(page, prompt, count=2)
            await logout_giz(page)
            return video_links
        finally:
            await context.close()
            await browser.close()
