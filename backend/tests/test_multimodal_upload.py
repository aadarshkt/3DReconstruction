import pytest
from pathlib import Path
from app.api.uploads import _classify_filename

def test_classify_filenames():
    assert _classify_filename("living_room.jpg") == "image"
    assert _classify_filename("FACADE_001.PNG") == "image"
    assert _classify_filename("photo.HEIC") == "image"
    assert _classify_filename("walkthrough.mp4") == "video"
    assert _classify_filename("room_scan.MOV") == "video"
    assert _classify_filename("room_model.usdz") == "lidar"
    assert _classify_filename("export.ply") == "lidar"
    assert _classify_filename("roomplan.json") == "lidar"
    assert _classify_filename("readme.txt") == "other"
