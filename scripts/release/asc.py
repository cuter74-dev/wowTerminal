"""App Store Connect API helper (#194).

Credentials are read from the developer's machine, never from the repo:
  $ASC_KEY_DIR (default ~/.appstoreconnect)/key_id.txt, issuer_id.txt,
  private_keys/AuthKey_<key id>.p8
Usage from the other scripts: `from asc import api, APP`.
"""
import base64
import json
import os
import subprocess
import time
import urllib.error
import urllib.request

APP = "6783178766"  # wowTerminal의 App Store Connect 앱 id

_D = os.path.expanduser(os.environ.get("ASC_KEY_DIR", "~/.appstoreconnect"))
_KID = open(os.path.join(_D, "key_id.txt")).read().strip()
_ISS = open(os.path.join(_D, "issuer_id.txt")).read().strip()
_PK = os.path.join(_D, "private_keys", f"AuthKey_{_KID}.p8")


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _jwt() -> str:
    now = int(time.time())
    h = _b64(json.dumps({"alg": "ES256", "kid": _KID, "typ": "JWT"}).encode())
    c = _b64(json.dumps({"iss": _ISS, "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"}).encode())
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", _PK], input=f"{h}.{c}".encode(), capture_output=True).stdout
    # openssl은 DER 서명을 낸다 — JWT(ES256)는 r||s 64바이트가 필요하다.
    i = 2 + (1 if der[1] & 0x80 else 0)
    assert der[i] == 2
    rl = der[i + 1]
    r = der[i + 2 : i + 2 + rl]
    j = i + 2 + rl
    sl = der[j + 1]
    s = der[j + 2 : j + 2 + sl]
    r = r.lstrip(b"\0").rjust(32, b"\0")
    s = s.lstrip(b"\0").rjust(32, b"\0")
    return f"{h}.{c}.{_b64(r + s)}"


def api(method: str, path: str, body=None):
    url = path if path.startswith("http") else "https://api.appstoreconnect.apple.com" + path
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body else None,
        headers={"Authorization": "Bearer " + _jwt(), "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, method, path, e.read().decode()[:600])
        raise


def wait_valid_build(build_version: str):
    """빌드(예: 0.22.2.22002)가 처리 완료(VALID)될 때까지 1분마다 본다. 빌드 데이터를 돌려준다."""
    for _ in range(90):
        b = api("GET", f"/v1/builds?filter[app]={APP}&filter[version]={build_version}"
                       "&fields[builds]=version,processingState,usesNonExemptEncryption")
        if b["data"] and b["data"][0]["attributes"]["processingState"] == "VALID":
            build = b["data"][0]
            # gen/apple을 새로 만들면 Info.plist에 암호화 키가 없어 매번 정해 줘야 한다.
            if build["attributes"].get("usesNonExemptEncryption") is None:
                api("PATCH", f"/v1/builds/{build['id']}",
                    {"data": {"type": "builds", "id": build["id"], "attributes": {"usesNonExemptEncryption": False}}})
            return build
        print("build", build_version, b["data"][0]["attributes"]["processingState"] if b["data"] else "not yet", flush=True)
        time.sleep(60)
    raise SystemExit("build not VALID")


def set_whats_new(version_id: str, notes: str):
    for loc in api("GET", f"/v1/appStoreVersions/{version_id}/appStoreVersionLocalizations")["data"]:
        api("PATCH", f"/v1/appStoreVersionLocalizations/{loc['id']}",
            {"data": {"type": "appStoreVersionLocalizations", "id": loc["id"], "attributes": {"whatsNew": notes}}})


def submit_for_review(version_id: str):
    rs = api("POST", "/v1/reviewSubmissions", {"data": {"type": "reviewSubmissions", "attributes": {"platform": "IOS"},
             "relationships": {"app": {"data": {"type": "apps", "id": APP}}}}})
    rid = rs["data"]["id"]
    api("POST", "/v1/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
        "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": rid}},
        "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version_id}}}}})
    r = api("PATCH", f"/v1/reviewSubmissions/{rid}",
            {"data": {"type": "reviewSubmissions", "id": rid, "attributes": {"submitted": True}}})
    return r["data"]["attributes"].get("state")
