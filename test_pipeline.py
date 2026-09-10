#!/usr/bin/env python3
"""
Test script to drive the 3D Reconstruction Pipeline APIs.
It handles creating a job, uploading files, starting the pipeline,
monitoring real-time WebSocket progress, and fetching final results.
"""
import argparse
import time
import httpx
import sys
import json
import os
import asyncio
import websockets

API_URL = "http://localhost:8000"

async def monitor_progress(job_id):
    ws_url = f"ws://localhost:8000/jobs/{job_id}/ws"
    try:
        async with websockets.connect(ws_url) as ws:
            while True:
                msg = await ws.recv()
                data = json.loads(msg)
                stage = data.get('stage')
                pct = data.get('pct')
                print(f"[WebSocket] Progress: {stage} ({pct}%)")
                
                # Check for completion or failure
                if stage in ["complete", "failed"]:
                    if data.get("error"):
                        print(f"[!] Pipeline Error: {data.get('error')}")
                    break
    except websockets.exceptions.ConnectionClosed:
        print("[WebSocket] Connection closed.")
    except Exception as e:
        print(f"[!] WebSocket error: {e}")

def main():
    parser = argparse.ArgumentParser(description="Test 3D Reconstruction Pipeline API")
    parser.add_argument("--tier", choices=["photos", "video", "lidar", "hybrid"], required=True, help="Capture tier")
    parser.add_argument("--scale", type=float, help="Scale reference in meters (required for photos/video)")
    parser.add_argument("--files", nargs="+", required=True, help="File(s) to upload (.mp4, .jpg, .json, etc.)")
    args = parser.parse_args()

    # 1. Create Job
    payload = {"tier": args.tier}
    if args.scale is not None:
        payload["scale_reference_m"] = args.scale
    
    print(f"[*] Creating job for tier '{args.tier}'...")
    r = httpx.post(f"{API_URL}/jobs/create", json=payload)
    if r.status_code != 201:
        print(f"[!] Failed to create job. Response ({r.status_code}):\n{r.text}")
        sys.exit(1)
    
    job_id = r.json()["job_id"]
    print(f"[+] Job Created: {job_id}")

    # 2. Upload Files
    print(f"[*] Uploading {len(args.files)} file(s)...")
    files_to_upload = []
    file_handles = []
    
    try:
        for fpath in args.files:
            if not os.path.exists(fpath):
                print(f"[!] File not found: {fpath}")
                sys.exit(1)
            
            # Keep file handles open during the request
            fh = open(fpath, "rb")
            file_handles.append(fh)
            files_to_upload.append(("files", (os.path.basename(fpath), fh)))
        
        r = httpx.post(f"{API_URL}/jobs/{job_id}/upload", files=files_to_upload)
        if r.status_code != 200:
            print(f"[!] Upload failed. Response ({r.status_code}):\n{r.text}")
            sys.exit(1)
            
        print(f"[+] Successfully uploaded {r.json()['count']} file(s).")
    finally:
        # Clean up file handles
        for fh in file_handles:
            fh.close()

    # 3. Start Processing
    print(f"[*] Starting reconstruction job...")
    r = httpx.post(f"{API_URL}/jobs/{job_id}/start")
    if r.status_code != 200:
        print(f"[!] Start failed. Response ({r.status_code}):\n{r.text}")
        sys.exit(1)
    
    print(f"[+] Job started in Celery worker!")

    # 4. Monitor Progress via WebSocket
    print("[*] Monitoring progress via WebSocket...\n")
    try:
        asyncio.run(monitor_progress(job_id))
    except KeyboardInterrupt:
        print("\n[!] Stopped monitoring early. Job might still be running in background.")

    # 5. Fetch Final Results Analysis
    print("\n[*] Fetching final results analysis...")
    r = httpx.get(f"{API_URL}/jobs/{job_id}/results")
    if r.status_code == 200:
        res = r.json()
        print("\n========================================================")
        print("                   FINAL RESULTS                        ")
        print("========================================================")
        print(f"Status           : {res.get('status')}")
        print(f"Scale Confidence : {res.get('scale_confidence')}")
        print(f"Room Area        : {res.get('room_area_m2')} m²")
        print(f"Wall Count       : {res.get('wall_count')}")
        
        err_est = res.get("error_estimate")
        if err_est:
            print(f"Error Estimate   : +/- {err_est.get('expected_wall_error_cm')} cm ({err_est.get('method')})")
        
        print("\nGenerated Files (Ready for Download/View):")
        files = res.get("files", {})
        for key, uri in files.items():
            if uri:
                print(f" ╰─ {key.upper().ljust(15)} : {API_URL}{uri}")
        
        print("\n[*] To visualize these results in 3D:")
        print(f"    1. Open web_dashboard/index.html in your browser")
        print(f"    2. Enter Job ID: {job_id}")
        print("========================================================")
    else:
        print(f"[!] Failed to fetch results. Response ({r.status_code}):\n{r.text}")

if __name__ == "__main__":
    main()
