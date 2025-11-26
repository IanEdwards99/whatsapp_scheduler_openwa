#!/usr/bin/env python3
"""
Enhanced background scheduler with status tracking and recurring logic
"""

import time
import requests
import logging
from datetime import datetime
from scheduler_core import MessageScheduler

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SCHEDULE_FILE = "schedules/schedule.json"
DRIVER_SERVER_URL = "http://127.0.0.1:5001"
CHECK_INTERVAL = 10  # Check every 10 seconds for better responsiveness


class EnhancedScheduleProcessor:
    """Process schedules with status tracking"""
    
    def __init__(self, schedule_file: str, driver_url: str):
        self.scheduler = MessageScheduler(schedule_file)
        self.driver_url = driver_url
    
    def check_driver_ready(self) -> bool:
        """Check if driver is ready"""
        try:
            response = requests.get(f"{self.driver_url}/status", timeout=2)
            if response.status_code == 200:
                return response.json().get('ready', False)
        except Exception:
            pass
        return False
    
    def process_schedules(self):
        """Process all pending schedules"""
        if not self.check_driver_ready():
            logger.warning("Driver not ready")
            return
        
        pending = self.scheduler.get_pending_schedules()
        
        for idx, schedule in pending:
            try:
                success = self._send_schedule(schedule)
                self.scheduler.mark_completed(idx, success)
                
                if success:
                    logger.info(f"✓ Completed: {schedule['contact']} ({schedule['type']})")
                else:
                    logger.error(f"✗ Failed: {schedule['contact']} ({schedule['type']})")
                
            except Exception as e:
                logger.error(f"Error processing schedule: {e}")
                self.scheduler.mark_completed(idx, False)
    
    def _send_schedule(self, schedule: dict) -> bool:
        """Send a single schedule"""
        sched_type = schedule.get('type')
        contact = schedule.get('contact')
        
        try:
            if sched_type == 'message':
                message = schedule.get('message')
                return self.scheduler.send_message_via_api(contact, message)
            
            elif sched_type == 'poll':
                question = schedule.get('question')
                options = schedule.get('options', [])
                return self.scheduler.send_poll_via_api(contact, question, options)
        
        except Exception as e:
            logger.error(f"Failed to send: {e}")
            return False
        
        return False
    
    def run(self):
        """Main loop"""
        logger.info(f"Starting enhanced scheduler (checking every {CHECK_INTERVAL}s)")
        logger.info(f"Schedule file: {self.scheduler.schedule_file}")
        logger.info(f"Driver URL: {self.driver_url}")
        
        try:
            while True:
                self.process_schedules()
                time.sleep(CHECK_INTERVAL)
        
        except KeyboardInterrupt:
            logger.info("Scheduler stopped by user")
        except Exception as e:
            logger.error(f"Scheduler error: {e}")
            raise


if __name__ == "__main__":
    processor = EnhancedScheduleProcessor(SCHEDULE_FILE, DRIVER_SERVER_URL)
    processor.run()

