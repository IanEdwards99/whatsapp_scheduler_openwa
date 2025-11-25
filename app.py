from flask import Flask, render_template, request, redirect, url_for, flash, session, jsonify
from scheduler import MessageScheduler
import requests
from requests.exceptions import RequestException
import subprocess
import os
import time

app = Flask(__name__)
app.secret_key = "your_secret_key"  # Replace with a secure key
scheduler = MessageScheduler("schedules/schedule.json")

# Driver server config
DRIVER_SERVER_URL = "http://127.0.0.1:5001"
DRIVER_SERVER_PATH = os.path.join(os.path.dirname(__file__), "server.js")

def ensure_driver_server():
    try:
        r = requests.get(f"{DRIVER_SERVER_URL}/status", timeout=2)
        if r.status_code == 200:
            return True
    except Exception:
        pass
    
    # Start driver_server (Node.js) in a subprocess
    try:
        subprocess.Popen(["node", DRIVER_SERVER_PATH])
        # Wait for it to start
        for _ in range(30):  # Increased timeout for Node.js startup
            try:
                r = requests.get(f"{DRIVER_SERVER_URL}/status", timeout=2)
                if r.status_code == 200:
                    return True
            except Exception:
                time.sleep(1)
    except Exception as e:
        print(f"Failed to start server: {e}")
    
    return False

@app.route("/")
def index():
    schedules = scheduler.list_schedules()
    return render_template("index.html", schedules=schedules, enumerate=enumerate)

@app.route("/add", methods=["GET", "POST"])
def add_schedule():
    if request.method == "POST":
        schedule_type = request.form.get("type")
        contact = request.form.get("contact")
        time = request.form.get("time")
        recurring = request.form.get("recurring")
        
        if schedule_type == "message":
            message = request.form.get("message")
            if not contact or not message or not time:
                flash("Please provide contact, message, and time.", "error")
                return redirect(url_for("add_schedule"))
            scheduler.add_message_schedule(contact, message, time, recurring)
            flash("Message schedule added successfully!", "success")
        elif schedule_type == "poll":
            question = request.form.get("question")
            options = request.form.get("options").split(",")
            if not contact or not question or not options or not time:
                flash("Please provide contact, question, options, and time.", "error")
                return redirect(url_for("add_schedule"))
            if len(options) != len(set(options)):
                flash("Poll options must be unique.", "error")
                return redirect(url_for("add_schedule"))
            scheduler.add_poll_schedule(contact, question, options, time, recurring)
            flash("Poll schedule added successfully!", "success")
        return redirect(url_for("index"))
    return render_template("add_schedule.html")

@app.route("/delete/<int:index>")
def delete_schedule(index):
    schedules = scheduler.list_schedules()
    if 0 <= index < len(schedules):
        deleted_schedule = schedules[index]
        scheduler.remove_schedule(index)
        session["deleted_schedule"] = deleted_schedule
        flash("Schedule deleted successfully! <a href='/undo_delete'>Undo</a>", "success")
    else:
        flash("Invalid schedule index.", "error")
    return redirect(url_for("index"))

@app.route("/undo_delete")
def undo_delete():
    deleted_schedule = session.pop("deleted_schedule", None)
    if deleted_schedule:
        scheduler.schedules.append(deleted_schedule)
        scheduler.save_schedules()
        flash("Deletion undone. Schedule restored.", "success")
    else:
        flash("No schedule to undo.", "error")
    return redirect(url_for("index"))

@app.route("/send_now", methods=["GET", "POST"])
def send_now():
    if request.method == "POST":
        schedule_type = request.form.get("type")
        contact = request.form.get("contact")

        if not ensure_driver_server():
            flash("Failed to start or connect to driver server.", "error")
            return redirect(url_for("send_now"))

        if schedule_type == "message":
            message = request.form.get("message")
            if not contact or not message:
                flash("Please provide contact and message.", "error")
                return redirect(url_for("send_now"))
            try:
                if scheduler.send_message_via_api(contact, message):
                    flash("Message sent successfully!", "success")
                else:
                    flash("Failed to send message.", "error")
            except Exception as e:
                flash(f"Error: {e}", "error")
        elif schedule_type == "poll":
            question = request.form.get("question")
            options = request.form.get("options").split(",")
            if not contact or not question or not options:
                flash("Please provide contact, question, and options.", "error")
                return redirect(url_for("send_now"))
            if len(options) != len(set(options)):
                flash("Poll options must be unique.", "error")
                return redirect(url_for("send_now"))
            try:
                if scheduler.send_poll_via_api(contact, question, options):
                    flash("Poll sent successfully!", "success")
                else:
                    flash("Failed to send poll.", "error")
            except Exception as e:
                flash(f"Error: {e}", "error")
        return redirect(url_for("index"))
    return render_template("send_now.html")

@app.route("/overview")
def overview():
    schedules = scheduler.list_schedules()
    return render_template("overview.html", schedules=schedules)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
