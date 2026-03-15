import os
import telebot
from dotenv import load_dotenv
from scheduler_core import MessageScheduler

# Load variables
load_dotenv()
TOKEN = os.getenv("TELEGRAM_TOKEN")
if not TOKEN:
    raise ValueError("No TELEGRAM_TOKEN found in environment variables.")

bot = telebot.TeleBot(TOKEN)
scheduler = MessageScheduler("schedules/schedule.json")

@bot.message_handler(commands=['start', 'help'])
def send_welcome(message):
    help_text = (
        "🤖 *WhatsApp Scheduler Bot*\n\n"
        "Here are the available commands:\n"
        "🔹 `/list` - List all upcoming schedules\n"
        "🔹 `/add <contact> | <message> | <YYYY-MM-DDTHH:MM> | [recurring]` - Add a new message schedule\n"
        "🔹 `/delete <index>` - Delete a schedule by its index\n"
        "\n_Example Add:_\n"
        "`/add John Doe | Hello World! | 2026-03-20T10:00 | weekly`\n"
        "(Recurring options: daily, weekly, monthly. Leave empty for none)"
    )
    bot.reply_to(message, help_text, parse_mode="Markdown")

@bot.message_handler(commands=['list'])
def list_schedules(message):
    schedules = scheduler.load_schedules()
    if not schedules:
        bot.reply_to(message, "📭 No schedules found.")
        return
        
    response = "🗓 *Current Schedules:*\n\n"
    for i, s in enumerate(schedules):
        status = "✅" if s.get('status') == 'completed' else "⏳"
        date_str = s.get('next_run') or s.get('time')
        contact = s.get('contact')
        msg = s.get('message') or s.get('question')
        sched_type = s.get('type', 'Unknown')
        
        preview = msg[:30] + '...' if msg and len(msg) > 30 else msg
        response += f"*{i}*. {status} {date_str} -> {contact}\n"
        response += f"   Type: _{sched_type}_ | \"{preview}\"\n\n"
        
    # Send long messages in chunks if necessary (Telegram limit is 4096)
    if len(response) > 4000:
        for x in range(0, len(response), 4000):
            bot.reply_to(message, response[x:x+4000], parse_mode="Markdown")
    else:
        bot.reply_to(message, response, parse_mode="Markdown")

@bot.message_handler(commands=['delete'])
def delete_schedule(message):
    try:
        parts = message.text.split(maxsplit=1)
        if len(parts) < 2:
            bot.reply_to(message, "⚠️ Usage: `/delete <index>`", parse_mode="Markdown")
            return
            
        index = int(parts[1].strip())
        schedules = scheduler.load_schedules()
        if 0 <= index < len(schedules):
            removed = scheduler.remove_schedule(index)
            bot.reply_to(message, f"🗑 Deleted schedule for: {removed.get('contact')}")
        else:
            bot.reply_to(message, "❌ Invalid index.")
    except Exception as e:
        bot.reply_to(message, f"Error: {e}")

@bot.message_handler(commands=['add'])
def add_schedule(message):
    try:
        # Expected format: /add Contact | Message text | 2026-03-15T15:00 | weekly
        cmd_text = message.text[len('/add '):]
        parts = [p.strip() for p in cmd_text.split('|')]
        
        if len(parts) < 3:
            bot.reply_to(message, "⚠️ Incorrect format.\nUsage: `/add Contact | Message | YYYY-MM-DDTHH:MM | [recurring]`", parse_mode="Markdown")
            return
            
        contact = parts[0]
        msg_text = parts[1]
        datetime_str = parts[2]
        recurring = parts[3] if len(parts) > 3 and parts[3] else None
        
        scheduler.add_message_schedule(contact, msg_text, datetime_str, recurring)
        
        bot.reply_to(message, f"✅ Schedule added for *{contact}* at `{datetime_str}`", parse_mode="Markdown")
    except Exception as e:
        bot.reply_to(message, f"❌ Failed to add schedule: {e}")

if __name__ == '__main__':
    print("🤖 Telegram bot is polling...")
    bot.infinity_polling()
