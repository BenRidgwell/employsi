#!/bin/bash
# Geocode an ADDRESS and gate on the street match, exactly as geocode-au.py
# does: the road Nominatim reports must be the road the address named. That is
# the check that catches "right city, wrong building".
S="$1"; IN="$2"; OUT="$3"
UA="employsi-geocode/1.0 (https://github.com/BenRidgwell/employsi)"
: > "$OUT"
while IFS=$'\t' read -r city id name addr street; do
  [ -z "$id" ] && continue
  q=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$addr")
  f="$S/addr/geo-$id.json"
  [ -s "$f" ] || { curl -sL -m 25 -A "$UA" -o "$f" \
      "https://nominatim.openstreetmap.org/search?q=$q&format=jsonv2&limit=3&addressdetails=1"; sleep 1.2; }
  python3 - "$city" "$id" "$name" "$addr" "$street" "$f" >> "$OUT" <<'PY'
import json,sys
city,cid,name,addr,street,path=sys.argv[1:7]
try: d=json.load(open(path))
except Exception: d=[]
if not d:
    print("\t".join([city,cid,name,addr,"","","NO RESULT"])); raise SystemExit
best=d[0]
a=best.get("address",{})
road=a.get("road") or a.get("pedestrian") or a.get("neighbourhood") or ""
ok = street.lower() in road.lower() or street.lower() in (best.get("display_name","")).lower()
print("\t".join([city,cid,name,addr,best.get("lon",""),best.get("lat",""),
                 ("MATCH " if ok else "STREET MISMATCH ")+ (road or best.get("display_name","")[:40])]))
PY
done < "$IN"
echo "DONE"
