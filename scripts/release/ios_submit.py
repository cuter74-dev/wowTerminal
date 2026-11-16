"""iOS 심사 제출 (#194): python3 ios_submit.py <스토어 버전 1.0.x> <빌드 버전 예: 0.22.2.22002> <새 기능 문구 파일>

빌드가 VALID가 되길 기다린 뒤 스토어 버전을 만들고(승인 후 자동 출시), 빌드를 붙이고,
새 기능 문구(en-US)를 넣어 심사에 낸다. 문구에 •·따옴표가 있으면 409로 거부된다 — "-" 목록만.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc import APP, api, set_whats_new, submit_for_review, wait_valid_build  # noqa: E402

ver, build_version, notes = sys.argv[1], sys.argv[2], open(sys.argv[3]).read().strip()
build = wait_valid_build(build_version)
v = api("POST", "/v1/appStoreVersions", {"data": {"type": "appStoreVersions",
        "attributes": {"platform": "IOS", "versionString": ver, "releaseType": "AFTER_APPROVAL"},
        "relationships": {"app": {"data": {"type": "apps", "id": APP}}}}})
vid = v["data"]["id"]
api("PATCH", f"/v1/appStoreVersions/{vid}/relationships/build", {"data": {"type": "builds", "id": build["id"]}})
set_whats_new(vid, notes)
print("submitted", ver, "build", build_version, "state", submit_for_review(vid))
