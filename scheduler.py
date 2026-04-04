"""
scheduler.py — runs insurance_scraper.py once every 24 hours.
Start with: python scheduler.py
"""
import time, json, logging, subprocess, sys
from datetime import datetime, timedelta
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [SCHEDULER] %(message)s",
                    handlers=[logging.FileHandler("logs/scheduler.log"), logging.StreamHandler()])
log = logging.getLogger(__name__)

RUN_LOG     = Path("insurance_policies/run_history.json")
CHECK_EVERY = 3600       # poll every 1 hour
SYNC_EVERY  = 86400      # sync every 24 hours

def last_run():
    if not RUN_LOG.exists(): return None
    h = json.loads(RUN_LOG.read_text())
    return datetime.fromisoformat(h[-1]["run_at"]) if h else None

def should_run():
    last = last_run()
    return last is None or (datetime.now() - last).total_seconds() >= SYNC_EVERY

def main():
    log.info("Scheduler started — syncs every 24h, checks every 1h. Ctrl+C to stop.")
    while True:
        if should_run():
            log.info("Starting daily sync...")
            r = subprocess.run([sys.executable, "insurance_scraper.py"])
            log.info(f"Sync done (exit code {r.returncode})")
        else:
            next_run = last_run() + timedelta(seconds=SYNC_EVERY)
            log.info(f"Next sync at {next_run:%Y-%m-%d %H:%M} — sleeping {CHECK_EVERY//60}min")
        time.sleep(CHECK_EVERY)

if __name__ == "__main__":
    main()
