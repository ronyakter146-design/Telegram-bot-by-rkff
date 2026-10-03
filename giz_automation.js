const puppeteer = require('puppeteer');
const axios = require('axios');
const fs = require('fs');

const GIZ_SIGNUP_URL = 'https://www.giz.ai/signUp';
const GIZ_VIDEO_URL = 'https://app.giz.ai/ai-video-generator';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function generatePassword(length = 12) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$';
  let pass = '';
  for (let i = 0; i < length; i++) {
    pass += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return pass;
}

async function createTempInbox() {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const domainRes = await axios.get('https://api.mail.tm/domains');
      const domain = domainRes.data['hydra:member'][0].domain;
      const username = Math.random().toString(36).substring(2, 12);
      const email = `${username}@${domain}`;
      const password = Math.random().toString(36).substring(2, 14);

      const accRes = await axios.post('https://api.mail.tm/accounts', { address: email, password });
      if (accRes.status !== 200 && accRes.status !== 201) {
        console.log(`[MailTM] Failed: ${accRes.status}`);
        await sleep(2000);
        continue;
      }

      const tokenRes = await axios.post('https://api.mail.tm/token', { address: email, password });
      console.log(`[MailTM] Created: ${email}`);
      return { email, token: tokenRes.data.token };
    } catch (e) {
      console.log(`[MailTM] Attempt ${attempt + 1} error: ${e.message}`);
      await sleep(2000);
    }
  }
  throw new Error('ইমেইল তৈরি করা যায়নি!');
}

async function waitForOTP(token, timeoutSec = 90) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < timeoutSec) {
    try {
      const res = await axios.get('https://api.mail.tm/messages', {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.data['hydra:totalItems'] > 0) {
        const msgId = res.data['hydra:member'][0].id;
        const msgRes = await axios.get(`https://api.mail.tm/messages/${msgId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const body = msgRes.data.text || msgRes.data.html || '';
        const match = body.match(/\b(\d{6})\b/);
        if (match) {
          console.log(`[OTP] Found: ${match[1]}`);
          return match[1];
        }
      }
    } catch (e) {
      console.log(`[OTP] Error: ${e.message}`);
    }
    await sleep(5000);
  }
  return null;
}

async function clickButtonByText(page, text) {
  return await page.evaluate((txt) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const btn = buttons.find(b => b.textContent.trim().includes(txt));
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  }, text);
}

async function signupGiz(page, email, token, password) {
  await page.goto(GIZ_SIGNUP_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  // ─── Step 1: Email ───
  await page.waitForSelector('input[placeholder="you@example.com"]', { timeout: 15000 });
  await page.click('input[placeholder="you@example.com"]');
  await page.type('input[placeholder="you@example.com"]', email, { delay: 50 });
  await sleep(1000);

  await clickButtonByText(page, 'Continue with Email');
  console.log('[Flow] Clicked Continue with Email');
  await sleep(5000);

  // ─── Step 2: OTP ───
  await page.waitForSelector('input[placeholder*="6-digit code"]', { timeout: 20000 });
  const code = await waitForOTP(token);
  if (!code) {
    await page.screenshot({ path: 'error_screenshot.png' });
    throw new Error('ইনবক্সে OTP কোড আসেনি!');
  }

  await page.click('input[placeholder*="6-digit code"]');
  await page.type('input[placeholder*="6-digit code"]', code, { delay: 50 });
  console.log(`[Flow] Filled OTP: ${code}`);

  // OTP verify হওয়ার জন্য ১০ সেকেন্ড অপেক্ষা
  await sleep(10000);

  // Debug: লগে ইনপুট ফিল্ড দেখাও
  const inputsInfo = await page.evaluate(() => {
    const inputs = document.querySelectorAll('input');
    return Array.from(inputs).map((inp, i) => ({
      index: i,
      type: inp.type,
      placeholder: inp.placeholder,
      value: inp.value ? inp.value.substring(0, 15) : '',
      visible: inp.offsetParent !== null
    }));
  });
  console.log('[Debug] Input fields:', JSON.stringify(inputsInfo));

  // ─── Step 3: নাম ও পাসওয়ার্ড পজিশন ধরে পূরণ ───
  const fillResult = await page.evaluate((data) => {
    const allInputs = Array.from(document.querySelectorAll('input')).filter(i => i.offsetParent !== null);
    const passwordInputs = allInputs.filter(i => i.type === 'password');
    const firstPwdIdx = allInputs.indexOf(passwordInputs[0]);

    let nameFilled = false;
    let passFilled = false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

    // পাসওয়ার্ড ফিল্ডের ঠিক আগে যে খালি টেক্সট বক্স আছে, সেটাই "Your name"
    for (let i = 0; i < firstPwdIdx; i++) {
      const inp = allInputs[i];
      if (inp.type === 'password' || inp.type === 'email') continue;
      if (inp.readOnly || inp.disabled) continue;
      if (inp.value && inp.value.length > 0) continue;

      setter.call(inp, data.name);
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      nameFilled = true;
      console.log(`[Debug] Name filled at index ${i}`);
      break;
    }

    // পাসওয়ার্ড ফিল্ড দুটো ভরে দাও
    if (passwordInputs.length >= 2) {
      setter.call(passwordInputs[0], data.password);
      passwordInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      passwordInputs[0].dispatchEvent(new Event('change', { bubbles: true }));
      setter.call(passwordInputs[1], data.password);
      passwordInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      passwordInputs[1].dispatchEvent(new Event('change', { bubbles: true }));
      passFilled = true;
    }

    return { nameFilled, passFilled, firstPwdIdx, totalInputs: allInputs.length };
  }, { name: 'Temp User', password });

  console.log('[Debug] Fill result:', JSON.stringify(fillResult));

  if (!fillResult.nameFilled || !fillResult.passFilled) {
    await page.screenshot({ path: 'error_screenshot.png' });
    throw new Error(`ফিল্ড পূরণ করা যায়নি: ${JSON.stringify(fillResult)}`);
  }

  await sleep(2000);

  // ─── Step 4: Create an account বাটনে ক্লিক ───
  const clicked = await clickButtonByText(page, 'Create an account');
  if (!clicked) {
    await page.screenshot({ path: 'error_screenshot.png' });
    throw new Error('Create an account বাটন পাওয়া যায়নি!');
  }
  console.log('[Flow] Clicked Create an account');
  await sleep(8000);
}

async function generateVideos(page, prompt, count = 2) {
  const results = [];
  await page.goto(GIZ_VIDEO_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);

  for (let i = 0; i < count; i++) {
    // Prompt ইনপুট
    try {
      await page.waitForSelector('textarea', { timeout: 10000 });
      const textareas = await page.$$('textarea');
      if (textareas.length > 0) {
        await textareas[0].click();
        await textareas[0].type(prompt, { delay: 20 });
      }
    } catch (e) {
      console.log(`[Video ${i + 1}] Prompt fill error: ${e.message}`);
    }

    await sleep(1000);

    // Generate বাটন
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      const btn = buttons.find(b =>
        b.textContent.trim().includes('Generate') ||
        b.textContent.trim().includes('Create')
      );
      if (btn) { btn.click(); return true; }
      return false;
    });

    if (!clicked) console.log(`[Video ${i + 1}] Generate বাটন পাওয়া যায়নি`);

    await sleep(20000);

    // ভিডিও লিংক সংগ্রহ
    const videoSrcs = await page.evaluate(() => {
      const videos = document.querySelectorAll('video');
      const srcs = [];
      videos.forEach(v => {
        const src = v.src || (v.querySelector('source') ? v.querySelector('source').src : '');
        if (src) srcs.push(src);
      });
      return srcs;
    });

    if (videoSrcs.length > 0) {
      results.push(videoSrcs[0]);
      console.log(`[Video ${i + 1}] Got: ${videoSrcs[0]}`);
    }

    if (i < count - 1) {
      await page.reload({ waitUntil: 'networkidle2' });
      await sleep(3000);
    }
  }
  return results;
}

async function logoutGiz(page) {
  try {
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, div[class*="avatar"]'));
      const avatar = btns.find(b => b.className && b.className.includes('avatar'));
      if (avatar) avatar.click();
    });
    await sleep(2000);
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, div'));
      const logout = els.find(e => e.textContent && (e.textContent.includes('Logout') || e.textContent.includes('Sign out')));
      if (logout) logout.click();
    });
  } catch (e) {
    console.log(`[Logout] Error: ${e.message}`);
    await page.goto('https://app.giz.ai/api/auth/signOut', { waitUntil: 'networkidle2' });
  }
  await sleep(2000);
}

async function runGizFlow(prompt) {
  const { email, token } = await createTempInbox();
  const password = generatePassword();
  console.log(`[Flow] Email: ${email}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-zygote'
    ]
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await signupGiz(page, email, token, password);
    const videoLinks = await generateVideos(page, prompt, 2);
    await logoutGiz(page);
    return videoLinks;
  } finally {
    await browser.close();
  }
}

module.exports = { runGizFlow };
