"""Google Play 프로덕션 업로드 (#194): python3 play_upload.py <버전 이름> <영문 노트 파일> <한글 노트 파일>

- WT_PLAY_KEY: Play API 서비스 계정 키(JSON) 경로 — 저장소 밖, 개발자 맥에만 있다(필수).
- WT_AAB: 올릴 AAB 경로(기본: 이 저장소의 universalRelease 결과물).
edit 만들기 → 번들 업로드 → production 트랙 completed(노트 en-US·ko-KR) → commit.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
KEY = os.environ.get("WT_PLAY_KEY") or sys.exit("WT_PLAY_KEY(서비스 계정 키 경로)를 정하세요")
AAB = os.environ.get("WT_AAB") or os.path.join(
    ROOT, "src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab")
PKG = "com.oopnwow.wowterminal"
name = sys.argv[1]
notes_en = open(sys.argv[2]).read().strip()
notes_ko = open(sys.argv[3]).read().strip()

k = json.load(open(KEY))
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
now = int(time.time())
h = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
c = b64(json.dumps({"iss": k["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher",
                    "aud": k["token_uri"], "iat": now, "exp": now + 3600}).encode())
fd, pem = tempfile.mkstemp(suffix=".pem")  # 0600, 서명 직후 지운다
try:
    os.write(fd, k["private_key"].encode())
    os.close(fd)
    sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", pem], input=f"{h}.{c}".encode(), capture_output=True).stdout
finally:
    os.remove(pem)
tok = json.load(urllib.request.urlopen(k["token_uri"], urllib.parse.urlencode(
    {"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": f"{h}.{c}.{b64(sig)}"}).encode()))["access_token"]


def req(method, url, data=None, ctype="application/json"):
    r = urllib.request.Request(url, data=data, method=method, headers={"Authorization": "Bearer " + tok, "Content-Type": ctype})
    return json.load(urllib.request.urlopen(r, timeout=600))


base = f"https://androidpublisher.googleapis.com/androidpublisher/v3/applications/{PKG}"
edit = req("POST", base + "/edits", b"{}")["id"]
up = req("POST", f"https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/{PKG}/edits/{edit}/bundles?uploadType=media",
         open(AAB, "rb").read(), "application/octet-stream")
vc = up["versionCode"]
print("uploaded versionCode", vc)
track = {"track": "production", "releases": [{"name": name, "versionCodes": [str(vc)], "status": "completed",
         "releaseNotes": [{"language": "en-US", "text": notes_en}, {"language": "ko-KR", "text": notes_ko}]}]}
print("track:", req("PUT", base + f"/edits/{edit}/tracks/production", json.dumps(track).encode())["releases"][0]["status"])
print("commit:", req("POST", base + f"/edits/{edit}:commit", b"{}").get("id"))
