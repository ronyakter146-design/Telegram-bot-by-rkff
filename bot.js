const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const fs = require('fs');
const { runGizFlow } = require('./giz_automation');

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 10000;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;

if (!BOT_TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN নেই!');
  process.exit(1);
}

// ─── Express Server (webhook এর জন্য) ───
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/', (req, res) => {
  res.send('Bot is running!');
});

// Telegram webhook endpoint
app.post(`/bot${BOT_TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// ─── Bot (polling ছাড়া) ───
const bot = new TelegramBot(BOT_TOKEN, { polling: false });

// ─── /start ───
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

// ─── Webhook সেটআপ ───
async function setupWebhook() {
  try {
    await bot.deleteWebHook();
    const webhookUrl = `${RENDER_URL}/bot${BOT_TOKEN}`;
    await bot.setWebHook(webhookUrl);
    console.log(`✅ Webhook set: ${webhookUrl}`);
  } catch (e) {
    console.error('❌ Webhook setup failed:', e.message);
  }
}

// ─── Server চালু করো ───
app.listen(PORT, async () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`RENDER_URL: ${RENDER_URL}`);
  if (RENDER_URL) {
    await setupWebhook();
  } else {
    console.log('⚠️ RENDER_EXTERNAL_URL পাওয়া যায়নি!');
  }
});
