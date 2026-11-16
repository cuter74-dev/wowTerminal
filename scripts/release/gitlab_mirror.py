"""GitLab 한국어 미러 (#194). GitLab 작업 트리(브랜치가 gitlab/main을 따라감) 안에서 돌린다.

python3 gitlab_mirror.py <GitHub 커밋> <한국어 커밋 메시지 파일> <CHANGELOG 항목 JSON>

GitHub 커밋을 --no-commit으로 가져오고, CHANGELOG.md는 GitLab 쪽(한국어)을 그대로 둔 채
[미배포] 절에 한국어 항목을 넣는다. 항목 JSON은 [["추가"|"변경"|"수정"|"제거", "- **…** … (#N)"], …]
(앞의 것이 위로 가도록 거꾸로 넣지 않는다 — 각 항목은 그 분류 머리 바로 아래에 들어간다).
끝나면 코드 동일성(src/, src-tauri/src/ 차이 줄 수 — 0이어야 한다)을 찍는다.
"""
import json
import subprocess
import sys

sha, msgfile, entries_json = sys.argv[1], sys.argv[2], sys.argv[3]


def run(*a):
    return subprocess.run(a, capture_output=True, text=True)


run("git", "cherry-pick", "--no-commit", sha)
run("git", "checkout", "HEAD", "--", "CHANGELOG.md")
s = open("CHANGELOG.md").read()
head = "## [미배포]\n"
i = s.index(head) + len(head)
end = s.index("\n## [", i)
section = s[i:end]
order = ["추가", "변경", "수정", "제거"]
for cat, text in json.load(open(entries_json)):
    h = f"\n### {cat}\n"
    if h in section:
        j = section.index(h) + len(h)
        section = section[:j] + text + "\n" + section[j:]
    else:
        # 추가 → 변경 → 수정 → 제거 순서를 지킨다
        pos = len(section.rstrip("\n"))
        for later in order[order.index(cat) + 1:]:
            k = section.find(f"\n### {later}\n")
            if k >= 0:
                pos = min(pos, k)
        section = section[:pos] + h + text + "\n" + section[pos:]
s = s[:i] + section + s[end:]
open("CHANGELOG.md", "w").write(s)
run("git", "add", "-A", "CHANGELOG.md", "docs", "scripts", "src", "src-tauri", "package.json", "package-lock.json")
r = run("git", "commit", "-q", "-F", msgfile)
print(r.stdout, r.stderr)
r = run("git", "diff", sha, "HEAD", "--", "src/", "src-tauri/src/")
print("parity lines:", len(r.stdout.splitlines()))
