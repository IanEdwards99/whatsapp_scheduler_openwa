#!/usr/bin/env python3
"""
Standalone background scheduler that processes scheduled messages and polls.
Runs independently of Flask, checking schedules and sending via the driver API.
"""

import json
import time
import requests
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SCHEDULE_FILE = "schedules/schedule.json"
DRIVER_SERVER_URL = "http://127.0.0.1:5001"
CHECK_INTERVAL = 60  # Check every 60 seconds


class ScheduleProcessor:
    """Process scheduled messages and polls"""
    
    def __init__(self, schedule_file: str, driver_url: str, check_interval: int = 60):
        self.schedule_file = schedule_file
        self.driver_url = driver_url
        self.check_interval = check_interval
        self.processed_times = set()  # Track which schedules we've already sent
    
    def load_schedules(self) -> List[Dict]:
        """Load schedules from JSON file"""
        try:
            if Path(self.schedule_file).exists():
                with open(self.schedule_file, 'r') as f:
                    return json.load(f)
        except Exception as e:
            logger.error(f"Error loading schedules: {e}")
        return []
    
    def check_driver_ready(self) -> bool:
        """Check if driver is running and ready"""
        try:
            response = requests.get(f"{self.driver_url}/status", timeout=2)
            if response.status_code == 200:
                data = response.json()
                return data.get('ready', False)
        except Exception:
            pass
        return False
    
    def resolve_group_name(self, contact: str) -> str:
        """Resolve group name to JID if needed"""
        # If already a JID (contains @), return as-is
        if '@' in contact:
            return contact
        
        try:
            response = requests.get(f"{self.driver_url}/get_groups", timeout=5)
            if response.status_code == 200:
                data = response.json()
                groups = data.get('groups', [])
                
                # Search for group with matching name (case-insensitive)
                for group in groups:
                    if group['name'].lower() == contact.lower():
                        logger.info(f"Resolved group name '{contact}' to JID '{group['id']}'")
                        return group['id']
        except Exception as e:
            logger.warning(f"Error resolving group name: {e}")
        
        logger.warning(f"Could not resolve '{contact}', using as-is")
        return contact
    
    def send_message(self, contact: str, message: str) -> bool:
        """Send a message via the driver API"""
        try:
            resolved_contact = self.resolve_group_name(contact)
            response = requests.post(
                f"{self.driver_url}/send_message",
                json={"contact": resolved_contact, "message": message},
                timeout=30
            )
            if response.status_code == 200:
                logger.info(f"✓ Message sent to {contact}")
                return True
            else:
                logger.error(f"✗ Failed to send message to {contact}: {response.text}")
                return False
        except Exception as e:
            logger.error(f"✗ Error sending message: {e}")
            return False
    
    def send_poll(self, contact: str, question: str, options: List[str]) -> bool:
        """Send a poll via the driver API"""
        try:
            resolved_contact = self.resolve_group_name(contact)
            response = requests.post(
                f"{self.driver_url}/send_poll",
                json={"contact": resolved_contact, "question": question, "options": options},
                timeout=30
            )
            if response.status_code == 200:
                data = response.json()
                method = data.get('method', 'unknown')
                logger.info(f"✓ Poll sent to {contact} (method: {method})")
                return True
            else:
                logger.error(f"✗ Failed to send poll to {contact}: {response.text}")
                return False
        except Exception as e:
            logger.error(f"✗ Error sending poll: {e}")
            return False
    
    def process_schedules(self):
        """Check and process all due schedules"""
        if not self.check_driver_ready():
            logger.warning("Driver not ready, skipping schedule check")
            return

        now = datetime.now()
        current_time_key = now.strftime("%H:%M")

        # Skip if we already processed this minute
        if current_time_key in self.processed_times:
            return

        schedules = self.load_schedules()
        if not schedules:
            return

        for idx, schedule in enumerate(schedules):
            try:
                schedule_time = schedule.get('time', '')
                if not schedule_time:
                    continue

                # Convert both to datetime.time for proper comparison
                schedule_dt = datetime.strptime(schedule_time, "%H:%M").time()
                now_dt = now.time()

                # Check if this schedule matches the current minute
                if schedule_dt <= now_dt:
                    print("match")
                    self._send_schedule(schedule)
                    self.processed_times.add(current_time_key)

                    # Prevent infinite growth
                    if len(self.processed_times) > 1440:  # 24 hours
                        self.processed_times.clear()

            except Exception as e:
                logger.error(f"Error processing schedule {idx}: {e}")

    
    def _send_schedule(self, schedule: Dict):
        """Send a single schedule"""
        sched_type = schedule.get('type')
        contact = schedule.get('contact')
        
        try:
            if sched_type == 'message':
                message = schedule.get('message')
                if message:
                    self.send_message(contact, message)
            
            elif sched_type == 'poll':
                question = schedule.get('question')
                options = schedule.get('options', [])
                if question and options:
                    self.send_poll(contact, question, options)
        
        except Exception as e:
            logger.error(f"Failed to send schedule: {e}")
    
    def run(self):
        """Main scheduler loop"""
        logger.info(f"Starting scheduler (checking every {self.check_interval}s)")
        logger.info(f"Schedule file: {self.schedule_file}")
        logger.info(f"Driver URL: {self.driver_url}")
        
        try:
            while True:
                self.process_schedules()
                time.sleep(1)
        
        except KeyboardInterrupt:
            logger.info("Scheduler stopped by user")
        except Exception as e:
            logger.error(f"Scheduler error: {e}")


if __name__ == "__main__":
    processor = ScheduleProcessor(SCHEDULE_FILE, DRIVER_SERVER_URL, CHECK_INTERVAL)
    processor.run()

