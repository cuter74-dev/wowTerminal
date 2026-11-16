"""심사 대기 중인 스토어 버전의 빌드를 새 빌드로 바꿔 다시 낸다 (#194).
python3 ios_swap.py <스토어 버전 1.0.x> <새 빌드 버전 예: 0.21.6.21006> <새 기능 문구 파일>
"""
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc import APP, api, set_whats_new, submit_for_review, wait_valid_build  # noqa: E402

ver, build_version, notes = sys.argv[1], sys.argv[2], open(sys.argv[3]).read().strip()
build = wait_valid_build(build_version)
v = api("GET", f"/v1/apps/{APP}/appStoreVersions?filter[versionString]={ver}&fields[appStoreVersions]=versionString,appStoreState")
vid, state = v["data"][0]["id"], v["data"][0]["attributes"]["appStoreState"]
print("version", ver, state, flush=True)
# 심사 대기 중인 제출을 취소하고, 버전 상태가 바뀌면 빌드를 갈아 끼운다.
subs = api("GET", f"/v1/reviewSubmissions?filter[app]={APP}&filter[state]=WAITING_FOR_REVIEW,READY_FOR_REVIEW&limit=5")
for s in subs["data"]:
    api("PATCH", f"/v1/reviewSubmissions/{s['id']}", {"data": {"type": "reviewSubmissions", "id": s["id"], "attributes": {"canceled": True}}})
    print("canceled submission", s["id"], flush=True)
for _ in range(40):
    st = api("GET", f"/v1/appStoreVersions/{vid}?fields[appStoreVersions]=appStoreState")["data"]["attributes"]["appStoreState"]
    if st in ("DEVELOPER_REJECTED", "PREPARE_FOR_SUBMISSION", "REJECTED"):
        break
    print("waiting cancel", st, flush=True)
    time.sleep(15)
api("PATCH", f"/v1/appStoreVersions/{vid}/relationships/build", {"data": {"type": "builds", "id": build["id"]}})
set_whats_new(vid, notes)
print("resubmitted", ver, "build", build_version, "state", submit_for_review(vid))
