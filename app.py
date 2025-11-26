from flask import Flask, render_template, request, redirect, url_for, flash, jsonify
from scheduler_core import MessageScheduler
import requests
from requests.exceptions import RequestException
import subprocess
import os
import time

app = Flask(__name__)
app.secret_key = "your_secret_key_change_in_production"
scheduler = MessageScheduler("schedules/schedule.json")

DRIVER_SERVER_URL = "http://127.0.0.1:5001"


def ensure_driver_server():
    """Ensure driver server is running"""
    try:
        r = requests.get(f"{DRIVER_SERVER_URL}/status", timeout=2)
        if r.status_code == 200:
            return True
    except Exception:
        pass
    return False


@app.route("/")
def index():
    schedules = scheduler.load_schedules()
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
            options = [opt.strip() for opt in options if opt.strip()]
            
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
    removed = scheduler.remove_schedule(index)
    if removed:
        flash("Schedule deleted successfully!", "success")
    else:
        flash("Invalid schedule index.", "error")
    return redirect(url_for("index"))


@app.route("/send_now", methods=["GET", "POST"])
def send_now():
    if request.method == "POST":
        if not ensure_driver_server():
            flash("Driver server not ready. Please ensure server.js is running.", "error")
            return redirect(url_for("send_now"))
        
        schedule_type = request.form.get("type")
        contact = request.form.get("contact")
        
        try:
            if schedule_type == "message":
                message = request.form.get("message")
                if not contact or not message:
                    flash("Please provide contact and message.", "error")
                    return redirect(url_for("send_now"))
                
                if scheduler.send_message_via_api(contact, message):
                    flash("Message sent successfully!", "success")
                else:
                    flash("Failed to send message.", "error")
            
            elif schedule_type == "poll":
                question = request.form.get("question")
                options = request.form.get("options").split(",")
                options = [opt.strip() for opt in options if opt.strip()]
                
                if not contact or not question or not options:
                    flash("Please provide contact, question, and options.", "error")
                    return redirect(url_for("send_now"))
                
                if len(options) != len(set(options)):
                    flash("Poll options must be unique.", "error")
                    return redirect(url_for("send_now"))
                
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
    schedules = scheduler.load_schedules()
    return render_template("overview.html", schedules=schedules)


@app.route("/api/status")
def api_status():
    """API endpoint for health check"""
    driver_ok = ensure_driver_server()
    return jsonify({
        "flask": "ok",
        "driver": "ok" if driver_ok else "down"
    })

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
