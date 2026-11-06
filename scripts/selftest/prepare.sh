#!/usr/bin/env bash
# Prepare a clean RealWorld self-test run (Git Bash / Linux / macOS):
#   1. upstream repo mirrored as sandbox/realworld/origin.git (cloned once from GitHub)
#   2. origin master reset to the pinned upstream commit, no snapshot refs, clean clones alice/bob
#   3. fresh Operator data: projects realworld + mini-shop, dev tokens for alice/bob written to their GTV_HOME
# Afterwards start the two daemons and run: node scripts/selftest/realworld.ts
set -euo pipefail
cd "$(dirname "$0")/../.."
ROOT=$(pwd -W 2>/dev/null || pwd) # Windows-style path under Git Bash, so Node gets a real path
PIN=30b68e1e881462b2f4164ea09ab4c4f5699c7b0b
COMPOSE="docker compose -f docker/compose.yml --env-file docker/.env"
ADMIN=$(grep '^GTV_ADMIN_TOKEN=' docker/.env | cut -d= -f2)

mkdir -p sandbox/realworld
[ -d sandbox/realworld/origin.git ] || git clone -q --bare https://github.com/gothinkster/node-express-realworld-example-app sandbox/realworld/origin.git
git -C sandbox/realworld/origin.git update-ref refs/heads/master $PIN
for repo in sandbox/realworld/origin.git sandbox/origin.git; do
  [ -d "$repo" ] || continue
  git -C "$repo" for-each-ref --format='%(refname)' refs/gtv | while read -r r; do git -C "$repo" update-ref -d "$r"; done
done
for d in alice bob; do
  dir=sandbox/realworld/$d
  if [ ! -d "$dir" ]; then
    git clone -q sandbox/realworld/origin.git "$dir"
    git -C "$dir" config user.name $d && git -C "$dir" config user.email $d@example.com
    printf ".claude/\n.codex/\n.mcp.json\n" > "$dir/.git/info/exclude"
  fi
  git -C "$dir" fetch -q origin && git -C "$dir" reset -q --hard origin/master && git -C "$dir" clean -qfd src
done
node bin/gtv.mjs install claude sandbox/realworld/alice --daemon http://127.0.0.1:7391 > /dev/null
node bin/gtv.mjs install codex sandbox/realworld/bob --daemon http://127.0.0.1:7392 > /dev/null

$COMPOSE stop operator > /dev/null 2>&1 || true
$COMPOSE rm -f operator > /dev/null 2>&1 || true
docker volume rm docker_gtv-data > /dev/null 2>&1 || true
$COMPOSE up -d operator > /dev/null
for _ in $(seq 1 60); do curl -sf -m 2 http://127.0.0.1:7390/health > /dev/null && break; sleep 1; done

# MSYS_NO_PATHCONV: Git Bash would rewrite /repos/... in the JSON body into C:/Program Files/Git/repos/...
api() { MSYS_NO_PATHCONV=1 curl -sf -X "$1" "http://127.0.0.1:7390$2" -H "authorization: Bearer $ADMIN" -H content-type:application/json -d "$3"; }
api POST /api/projects '{"id":"realworld","name":"RealWorld API (Node/Express)","repo_url":"/repos/realworld/origin.git","main_branch":"master"}' > /dev/null
[ -d sandbox/origin.git ] && api POST /api/projects '{"id":"mini-shop","name":"mini-shop sample","repo_url":"/repos/origin.git","main_branch":"main"}' > /dev/null
for d in alice bob; do
  port=$([ $d = alice ] && echo 7391 || echo 7392)
  token=$(api POST /api/devs "{\"name\":\"$d\"}" | node -e "let s='';process.stdin.on('data',x=>s+=x).on('end',()=>console.log(JSON.parse(s).token))")
  GTV_HOME="$ROOT/sandbox/.home-$d" node bin/gtv.mjs init --dev $d --server http://127.0.0.1:7390 --port $port --token "$token" > /dev/null
done
echo "Ready. Start the daemons (one terminal each), then: GTV_ADMIN_TOKEN=... node scripts/selftest/realworld.ts"
echo "  GTV_SNAPSHOT_DEBOUNCE_MS=20000 GTV_HOME=$ROOT/sandbox/.home-alice node bin/gtv.mjs daemon"
echo "  GTV_SNAPSHOT_DEBOUNCE_MS=20000 GTV_HOME=$ROOT/sandbox/.home-bob node bin/gtv.mjs daemon"
