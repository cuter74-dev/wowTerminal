"""심사 결과 감시 (#194): python3 ios_watch.py <스토어 버전 1.0.x>

10분마다 상태를 보고 대기·심사 중이 아니게 되면(출시·거절 등) 한 줄 찍고 끝난다.
연속 3번 못 읽으면 멈추고 알린다 — 도구가 사라져 헛도는 일이 있었다.
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc import APP, api  # noqa: E402

ver = sys.argv[1]
fails = 0
PENDING = ("WAITING_FOR_REVIEW", "IN_REVIEW", "PREPARE_FOR_SUBMISSION", "READY_FOR_REVIEW")
while True:
    try:
        r = api("GET", f"/v1/apps/{APP}/appStoreVersions?filter[versionString]={ver}&fields[appStoreVersions]=appStoreState")
        st = r["data"][0]["attributes"]["appStoreState"]
        fails = 0
        if st not in PENDING:
            print(f"{ver} state: {st} (seen {time.strftime('%m-%d %H:%M')})")
            break
        if len(sys.argv) > 2 and sys.argv[2] == "--once":
            print(f"{ver} state: {st}")
            break
    except Exception as e:  # noqa: BLE001
        fails += 1
        if fails >= 3:
            print(f"watch failed 3 times: {e}")
            break
    time.sleep(600)
