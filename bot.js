const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const fs = require('fs');
const { runGizFlow } = require('./giz_automation');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN নেই!');
  process.exit(1);
}

// ─── Telegram-এর পুরনো pending update / webhook ক্লিয়ার ───
async function clearPendingUpdates() {
  try {
    await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook?drop_pending_updates=true`);
    console.log('[Telegram] Webhook cleared & pending updates dropped.');
  } catch (e) {
    console.log('[Telegram] Clear failed:', e.message);
  }
}

const bot = new TelegramBot(BOT_TOKEN, {
  polling: {
    autoStart: true,
    interval: 1000,
    params: { timeout: 10 }
  }
});

// ─── Polling Error Handle (409 Conflict এড়ানোর জন্য) ───
bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.message && error.message.includes('409')) {
    console.log('[Warning] Polling conflict detected (409). Ignoring...');
    return;
  }
  console.error('[Polling Error]', error.message);
});

// ─── /start কমান্ড ───
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    '🎬 Giz.ai ভিডিও বট\n\n' +
    'তোমার প্রম্পট পাঠাও, আমি ২টি ভিডিও জেনারেট করে লিংক পাঠাবো।\n\n' +
    'উদাহরণ: A cat playing piano in a sunny room'
  );
});

// ─── মেসেজ হ্যান্ডলার ───
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const prompt = msg.text;

  if (!prompt || prompt.startsWith('/')) return;

  const statusMsg = await bot.sendMessage(
    chatId,
    '⏳ ভিডিও জেনারেট হচ্ছে... ২-৩ মিনিট অপেক্ষা করো।'
  );

  try {
    const videoLinks = await runGizFlow(prompt);

    if (videoLinks && videoLinks.length > 0) {
      let response = '✅ তোমার ভিডিও তৈরি!\n\n';
      videoLinks.forEach((link, i) => {
        response += `${i + 1}. ভিডিও ${i + 1}: ${link}\n`;
      });
      await bot.editMessageText(response, {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        disable_web_page_preview: true
      });
    } else {
      await bot.editMessageText('❌ কোনো ভিডিও জেনারেট হয়নি। আবার চেষ্টা করো।', {
        chat_id: chatId,
        message_id: statusMsg.message_id
      });
    }
  } catch (error) {
    console.error('Error:', error);
    if (fs.existsSync('error_screenshot.png')) {
      try {
        await bot.sendPhoto(chatId, 'error_screenshot.png', {
          caption: `❌ বট ওয়েবসাইটে সমস্যায় পড়েছে।\n\nএই ছবিটা ডেভেলপারকে পাঠাও।`
        });
      } catch (photoErr) {
        await bot.sendMessage(chatId, `❌ ছবি পাঠাতে সমস্যা: ${photoErr.message}`);
      }
    } else {
      await bot.editMessageText(
        `❌ ত্রুটি: ${String(error.message).substring(0, 200)}`,
        { chat_id: chatId, message_id: statusMsg.message_id }
      );
    }
  }
});

// ─── শুরুতে পুরনো update ক্লিয়ার করে বট চালু ───
clearPendingUpdates().then(() => {
  console.log('Bot started... Polling.');
});
