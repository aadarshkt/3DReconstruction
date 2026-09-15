#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8000}"

# Override these with env vars or edit the defaults.
POLICYHOLDER="${POLICYHOLDER:-Jane Doe}"
POLICY="${POLICY:-POL-123}"
ADDRESS="${ADDRESS:-123 Main St}"
INCIDENT="${INCIDENT:-Water damage}"
DESCRIPTION="${DESCRIPTION:-Test claim via test_claim.sh}"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <capture-folder> [scale_reference_m]"
  echo ""
  echo "Example:"
  echo "  $0 gerrard-hall/images 0.82"
  echo ""
  echo "Env overrides: BASE_URL, POLICYHOLDER, POLICY, ADDRESS, INCIDENT, DESCRIPTION"
  exit 1
fi

FOLDER="$1"
SCALE="${2:-}"

if [ ! -d "$FOLDER" ]; then
  echo "Error: folder not found: $FOLDER"
  exit 1
fi

# Build the create JSON (uses python3, no jq dependency).
create_body=$(python3 - "$POLICYHOLDER" "$POLICY" "$ADDRESS" "$INCIDENT" "$DESCRIPTION" "$SCALE" <<'PY'
import json, sys
name, policy, address, incident, desc, scale = sys.argv[1:7]
body = {
    "policyholder_name": name,
    "policy_number": policy,
    "property_address": address,
    "incident_type": incident,
    "incident_description": desc,
}
if scale:
    body["scale_reference_m"] = float(scale)
print(json.dumps(body))
PY
)

echo "==> Creating claim..."
create_resp=$(curl -s -X POST "$BASE_URL/claims/create" \
  -H 'Content-Type: application/json' \
  -d "$create_body")
claim_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["claim_id"])' <<<"$create_resp")
echo "Claim ID: $claim_id"

# Collect all recognized capture files (case-insensitive).
upload_args=()
while IFS= read -r -d '' f; do
  upload_args+=(-F "files=@$f")
done < <(find "$FOLDER" -maxdepth 1 -type f \( \
  -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.png' -o -iname '*.heic' \
  -o -iname '*.mp4' -o -iname '*.mov' \
  -o -iname '*.json' -o -iname '*.usdz' -o -iname '*.ply' -o -iname '*.obj' \) -print0)

if [ ${#upload_args[@]} -eq 0 ]; then
  echo "Error: no recognized capture files found in $FOLDER"
  exit 1
fi

echo "==> Uploading ${#upload_args[@]} file(s)..."
upload_resp=$(curl -s -X POST "$BASE_URL/claims/$claim_id/upload" "${upload_args[@]}")
python3 -c 'import json,sys; print("Uploaded count:", json.load(sys.stdin).get("count"))' <<<"$upload_resp"

echo "==> Starting claim agent..."
curl -s -X POST "$BASE_URL/claims/$claim_id/start" >/dev/null

echo "==> Polling claim status..."
status=""
while true; do
  claim_json=$(curl -s "$BASE_URL/claims/$claim_id")
  status=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])' <<<"$claim_json")
  pct=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["progress_pct"])' <<<"$claim_json")
  echo "    status=$status progress=$pct%"
  if [ "$status" = "ready_for_review" ] || [ "$status" = "failed" ]; then
    break
  fi
  sleep 5
done

if [ "$status" = "ready_for_review" ]; then
  echo "==> Fetching report..."
  curl -s "$BASE_URL/claims/$claim_id/report" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["report_markdown"])' \
    | tee "claim_report_${claim_id}.md"
  echo "Report saved to claim_report_${claim_id}.md"
else
  echo "==> Claim failed. Last response:"
  curl -s "$BASE_URL/claims/$claim_id" | python3 -m json.tool
  echo "Check worker logs with: ./run.sh logs worker"
  exit 1
fi
