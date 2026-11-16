"""데스크톱 릴리스 자산 검증 (#194): python3 verify_release.py <내려받은 폴더>

먼저 받기: gh release download vX.Y.Z -D <폴더> -p latest.json -p '*.sig' \
  -p wowTerminal_aarch64.app.tar.gz -p wowTerminal_x64.app.tar.gz -p '*x64-setup.exe' -p '*x64_en-US.msi'
- latest.json 플랫폼 수, windows-x86_64가 nsis와 같은지
- 모든 플랫폼의 signature가 .sig 파일과 같은지
- 맥 2종·윈도 2종 업데이트 파일의 minisign(Ed25519) 서명을 tauri.conf.json 공개키로 실제 파일에 대해 확인
`cryptography` 패키지가 필요하다.
"""
import base64
import hashlib
import json
import os
import sys

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
conf = json.load(open(os.path.join(ROOT, "src-tauri/tauri.conf.json")))
pk_txt = base64.b64decode(conf["plugins"]["updater"]["pubkey"]).decode().splitlines()
pk = base64.b64decode(pk_txt[1])
kid = pk[2:10]
key = Ed25519PublicKey.from_public_bytes(pk[10:42])
R = sys.argv[1]
d = json.load(open(os.path.join(R, "latest.json")))
print("version", d["version"], "platforms", len(d["platforms"]),
      "nsis-default:", d["platforms"]["windows-x86_64"] == d["platforms"]["windows-x86_64-nsis"])
seen = set()
for k, v in sorted(d["platforms"].items()):
    name = v["url"].rsplit("/", 1)[-1]
    assert v["url"].startswith("https://")
    assert v["signature"] == open(os.path.join(R, name + ".sig")).read().strip(), k
    if name in seen or name.endswith((".AppImage", ".deb", ".rpm")):
        continue  # 리눅스 패키지는 크기가 커서 .sig 일치만 본다
    seen.add(name)
    lines = base64.b64decode(v["signature"]).decode().splitlines()
    sig = base64.b64decode(lines[1])
    assert sig[2:10] == kid, f"key id mismatch: {name}"
    data = open(os.path.join(R, name), "rb").read()
    msg = hashlib.blake2b(data, digest_size=64).digest() if sig[:2] == b"ED" else data
    key.verify(sig[10:74], msg)
    tc = lines[2].split("trusted comment: ", 1)[1].encode()
    key.verify(base64.b64decode(lines[3]), sig[10:74] + tc)
    print("OK", name)
