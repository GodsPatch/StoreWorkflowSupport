#!/usr/bin/env bash
# Import + publish mọi workflow trong ./workflows vào n8n (chạy sau `docker compose up -d`).
# n8n 2.x: import qua CLI không tạo workflow_history nên phải tự thêm trước khi publish.
set -euo pipefail
cd "$(dirname "$0")/.."

for f in workflows/*.json; do
  id=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['id'])" "$f")
  echo "==> $f (id=$id)"
  docker compose exec -T n8n n8n import:workflow --input="/$f"
  docker compose exec -T n8n-db psql -U n8n -d n8n -q -c "
    insert into workflow_history(\"versionId\",\"workflowId\",authors,nodes,connections,name)
    select \"versionId\",id,'import',nodes,connections,name from workflow_entity where id='$id'
    on conflict (\"versionId\") do nothing"
  docker compose exec -T n8n n8n publish:workflow --id="$id"
done

docker compose restart n8n
echo "Xong. Đợi ~30s rồi mở n8n."
