import os
import logging
from telegram import Update
from telegram.ext import Application, CommandHandler, MessageHandler, filters, ContextTypes
from giz_automation import run_giz_flow

logging.basicConfig(
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN")

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🎬 Giz.ai ভিডিও বট\n\n"
        "তোমার প্রম্পট পাঠাও, আমি ২টি ভিডিও জেনারেট করে লিংক পাঠাবো।\n\n"
        "উদাহরণ: A cat playing piano in a sunny room"
    )

async def handle_prompt(update: Update, context: ContextTypes.DEFAULT_TYPE):
    prompt = update.message.text.strip()
    if not prompt:
        await update.message.reply_text("অনুগ্রহ করে একটি প্রম্পট পাঠাও।")
        return

    msg = await update.message.reply_text("⏳ ভিডিও জেনারেট হচ্ছে... ২-৩ মিনিট অপেক্ষা করো।")

    try:
        video_links = await run_giz_flow(prompt)

        if video_links:
            response = "✅ তোমার ভিডিও তৈরি!\n\n"
            for i, link in enumerate(video_links, 1):
                response += f"{i}. ভিডিও {i}: {link}\n"
            await msg.edit_text(response, disable_web_page_preview=True)
        else:
            await msg.edit_text("❌ কোনো ভিডিও জেনারেট হয়নি। আবার চেষ্টা করো।")

    except Exception as e:
        logger.error(f"Error: {e}")
        await msg.edit_text(f"❌ ত্রুটি: {str(e)[:200]}")

def main():
    if not BOT_TOKEN:
        raise ValueError("TELEGRAM_BOT_TOKEN নেই!")
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_prompt))
    logger.info("Bot started...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
