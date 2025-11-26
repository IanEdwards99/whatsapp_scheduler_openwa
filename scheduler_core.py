import json
import fcntl
import logging
import requests
from typing import List, Dict, Optional
from datetime import datetime, timedelta
from pathlib import Path
from contextlib import contextmanager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class ScheduleLock:
    """Context manager for file locking"""
    
    def __init__(self, filepath: str):
        self.filepath = filepath
        self.lockfile = f"{filepath}.lock"
        self.lock_fd = None
    
    def __enter__(self):
        # Create lock file if it doesn't exist
        Path(self.lockfile).touch()
        self.lock_fd = open(self.lockfile, 'w')
        fcntl.flock(self.lock_fd.fileno(), fcntl.LOCK_EX)
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.lock_fd:
            fcntl.flock(self.lock_fd.fileno(), fcntl.LOCK_UN)
            self.lock_fd.close()


class MessageScheduler:
    """Enhanced scheduler with status tracking, recurring logic, and file locking"""
    
    def __init__(self, schedule_file: str):
        self.schedule_file = schedule_file
        self.driver_server_url = "http://127.0.0.1:5001"
        
        # Ensure schedule file exists
        Path(schedule_file).parent.mkdir(parents=True, exist_ok=True)
        if not Path(schedule_file).exists():
            with open(schedule_file, 'w') as f:
                json.dump([], f)
    
    def _load_schedules_locked(self) -> List[Dict]:
        """Load schedules with file locking"""
        with ScheduleLock(self.schedule_file):
            try:
                with open(self.schedule_file, 'r') as f:
                    return json.load(f)
            except (FileNotFoundError, json.JSONDecodeError):
                return []
    
    def _save_schedules_locked(self, schedules: List[Dict]):
        """Save schedules with file locking"""
        with ScheduleLock(self.schedule_file):
            with open(self.schedule_file, 'w') as f:
                json.dump(schedules, f, indent=2)
    
    def load_schedules(self) -> List[Dict]:
        """Public method to load schedules"""
        return self._load_schedules_locked()
    
    def save_schedules(self, schedules: List[Dict]):
        """Public method to save schedules"""
        self._save_schedules_locked(schedules)
    
    def _calculate_next_run(self, current_time_str: str, recurring: str) -> str:
        """Calculate next run time based on recurring pattern"""
        try:
            current = datetime.strptime(current_time_str, "%H:%M")
            now = datetime.now()
            current_full = now.replace(hour=current.hour, minute=current.minute, second=0, microsecond=0)
            
            if recurring == "daily":
                next_run = current_full + timedelta(days=1)
            elif recurring == "weekly":
                next_run = current_full + timedelta(weeks=1)
            elif recurring == "monthly":
                # Approximate month as 30 days
                next_run = current_full + timedelta(days=30)
            else:
                return current_time_str
            
            return next_run.strftime("%H:%M")
        except Exception as e:
            logger.error(f"Error calculating next run: {e}")
            return current_time_str
    
    def add_message_schedule(self, contact: str, message: str, time: str, recurring: Optional[str] = None):
        """Add a message schedule with status tracking"""
        schedules = self._load_schedules_locked()
        
        schedule = {
            'type': 'message',
            'contact': contact,
            'message': message,
            'time': time,
            'recurring': recurring,
            'status': 'pending',
            'next_run': time,
            'last_run': None,
            'attempts': 0,
            'created_at': datetime.now().isoformat()
        }
        
        schedules.append(schedule)
        self._save_schedules_locked(schedules)
        logger.info(f"Added message schedule for {contact} at {time}")
    
    def add_poll_schedule(self, contact: str, question: str, options: List[str], time: str, recurring: Optional[str] = None):
        """Add a poll schedule with status tracking"""
        schedules = self._load_schedules_locked()
        
        schedule = {
            'type': 'poll',
            'contact': contact,
            'question': question,
            'options': options,
            'time': time,
            'recurring': recurring,
            'status': 'pending',
            'next_run': time,
            'last_run': None,
            'attempts': 0,
            'created_at': datetime.now().isoformat()
        }
        
        schedules.append(schedule)
        self._save_schedules_locked(schedules)
        logger.info(f"Added poll schedule for {contact} at {time}")
    
    def remove_schedule(self, index: int):
        """Remove a schedule by index"""
        schedules = self._load_schedules_locked()
        if 0 <= index < len(schedules):
            removed = schedules.pop(index)
            self._save_schedules_locked(schedules)
            logger.info(f"Removed schedule: {removed.get('contact')} at {removed.get('time')}")
            return removed
        return None
    
    def mark_completed(self, index: int, success: bool = True):
        """Mark a schedule as completed and handle recurring logic"""
        schedules = self._load_schedules_locked()
        
        if 0 <= index < len(schedules):
            schedule = schedules[index]
            schedule['last_run'] = datetime.now().isoformat()
            schedule['status'] = 'completed' if success else 'failed'
            
            # If recurring, create next occurrence
            if success and schedule.get('recurring'):
                next_time = self._calculate_next_run(schedule['time'], schedule['recurring'])
                
                new_schedule = schedule.copy()
                new_schedule['time'] = next_time
                new_schedule['next_run'] = next_time
                new_schedule['status'] = 'pending'
                new_schedule['last_run'] = None
                new_schedule['attempts'] = 0
                
                schedules.append(new_schedule)
                logger.info(f"Created next occurrence: {schedule['contact']} at {next_time}")
            
            self._save_schedules_locked(schedules)
    
    def get_pending_schedules(self) -> List[tuple]:
        """Get all pending schedules that should run now"""
        schedules = self._load_schedules_locked()
        now = datetime.now()
        current_time = now.strftime("%H:%M")
        
        pending = []
        for idx, schedule in enumerate(schedules):
            if schedule.get('status') == 'pending':
                schedule_time = schedule.get('next_run') or schedule.get('time')
                if schedule_time and schedule_time <= current_time:
                    pending.append((idx, schedule))
        
        return pending
    
    def _resolve_group_name(self, contact: str) -> str:
        """Resolve group name to JID"""
        if '@' in contact:
            return contact
        
        try:
            response = requests.get(f"{self.driver_server_url}/get_groups", timeout=5)
            if response.status_code == 200:
                groups = response.json().get('groups', [])
                for group in groups:
                    if group['name'].lower() == contact.lower():
                        logger.info(f"Resolved '{contact}' to '{group['id']}'")
                        return group['id']
        except Exception as e:
            logger.warning(f"Error resolving group: {e}")
        
        return contact
    
    def send_message_via_api(self, contact: str, message: str) -> bool:
        """Send message via driver API"""
        try:
            resolved = self._resolve_group_name(contact)
            response = requests.post(
                f"{self.driver_server_url}/send_message",
                json={"contact": resolved, "message": message},
                timeout=30
            )
            if response.status_code == 200:
                logger.info(f"✓ Message sent to {contact}")
                return True
            else:
                logger.error(f"✗ Failed: {response.text}")
                return False
        except Exception as e:
            logger.error(f"✗ Error: {e}")
            return False
    
    def send_poll_via_api(self, contact: str, question: str, options: List[str]) -> bool:
        """Send poll via driver API"""
        try:
            resolved = self._resolve_group_name(contact)
            response = requests.post(
                f"{self.driver_server_url}/send_poll",
                json={"contact": resolved, "question": question, "options": options},
                timeout=30
            )
            if response.status_code == 200:
                logger.info(f"✓ Poll sent to {contact}")
                return True
            else:
                logger.error(f"✗ Failed: {response.text}")
                return False
        except Exception as e:
            logger.error(f"✗ Error: {e}")
            return False
