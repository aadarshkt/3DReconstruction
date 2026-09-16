"""
Demo data generator for closed-loop UI testing of 3D Reconstruction and Insurance Claims.
"""
from pathlib import Path
import shutil
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_job_dir, get_results_dir, get_claim_dir, settings
from app.models.job import Job, JobStatus, Tier
from app.models.claim import Claim, ClaimStatus

log = structlog.get_logger()

DEMO_JOB_ID = "a441e175-fa81-54b1-872f-532658f8b0fa"
DEMO_CLAIM_ID = "9a4de56b-a2eb-5eb6-86fe-6ecb8d78daec"

SAMPLE_POLICY_PATH = Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "sample_ho3_policy.pdf"


def generate_demo_svg(out_path: Path):
    """Generate high-quality dimensioned floor plan SVG with water damage overlay."""
    svg_content = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 680 580" width="100%" height="100%" style="background:#0f172a; border-radius:8px;">
  <defs>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e293b" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="100%" height="100%" fill="url(#grid)" />

  <!-- Room Interior Fill -->
  <polygon points="100,100 540,100 540,460 100,460" fill="#1e293b" fill-opacity="0.6"/>

  <!-- Water Damage Zone -->
  <rect x="140" y="140" width="360" height="280" rx="12" fill="#0284c7" fill-opacity="0.22" stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="6,4"/>
  <text x="320" y="265" fill="#38bdf8" font-family="system-ui, -apple-system, sans-serif" font-size="14" font-weight="700" text-anchor="middle">💧 Saturated Water Damage Area (18.2 m²)</text>
  <text x="320" y="288" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11" text-anchor="middle">Drywall, subfloor &amp; baseboards soaked from kitchen sink pipe</text>

  <!-- Wall 1: Top (5.40 m) -->
  <line x1="100" y1="100" x2="540" y2="100" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <rect x="260" y="76" width="120" height="22" rx="4" fill="#0f172a" stroke="#6366f1" stroke-width="1"/>
  <text x="320" y="91" fill="#a5b4fc" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" text-anchor="middle">WALL 1: 5.40 m</text>

  <!-- Wall 2: Right (4.50 m) with Door -->
  <line x1="540" y1="100" x2="540" y2="230" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <line x1="540" y1="330" x2="540" y2="460" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <path d="M 540 230 A 90 90 0 0 1 450 320" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="4,3"/>
  <line x1="540" y1="230" x2="450" y2="230" stroke="#f59e0b" stroke-width="3"/>
  <text x="500" y="222" fill="#fbbf24" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600">Doorway</text>
  <text x="560" y="280" fill="#a5b4fc" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700">4.50 m</text>

  <!-- Wall 3: Bottom (5.40 m) with Window -->
  <line x1="540" y1="460" x2="380" y2="460" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <line x1="260" y1="460" x2="100" y2="460" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <line x1="260" y1="460" x2="380" y2="460" stroke="#38bdf8" stroke-width="5"/>
  <text x="320" y="482" fill="#38bdf8" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="600" text-anchor="middle">Window (1.20 m)</text>
  <rect x="260" y="495" width="120" height="22" rx="4" fill="#0f172a" stroke="#6366f1" stroke-width="1"/>
  <text x="320" y="510" fill="#a5b4fc" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" text-anchor="middle">WALL 3: 5.40 m</text>

  <!-- Wall 4: Left (4.50 m) -->
  <line x1="100" y1="460" x2="100" y2="100" stroke="#f8fafc" stroke-width="8" stroke-linecap="round"/>
  <text x="75" y="280" fill="#a5b4fc" font-family="system-ui, -apple-system, sans-serif" font-size="11" font-weight="700" text-anchor="middle" transform="rotate(-90 75 280)">WALL 4: 4.50 m</text>

  <!-- Room Info Badge -->
  <rect x="115" y="115" width="180" height="50" rx="6" fill="#0f172a" fill-opacity="0.9" stroke="#334155" stroke-width="1"/>
  <text x="125" y="135" fill="#f8fafc" font-family="system-ui, -apple-system, sans-serif" font-size="12" font-weight="700">Kitchen &amp; Living Room</text>
  <text x="125" y="152" fill="#94a3b8" font-family="system-ui, -apple-system, sans-serif" font-size="11">Total Area: 24.5 m² (Native LiDAR)</text>
</svg>"""
    out_path.write_text(svg_content)


def generate_demo_ply(out_path: Path):
    """Generate lightweight ASCII PLY point cloud representing the 3D room."""
    points = []
    # Room dimensions: X: [-2.7, 2.7], Y: [0.0, 2.6], Z: [-2.25, 2.25]
    # 1. Floor grid points (Y = 0)
    for x_i in range(-27, 28, 3):
        x = x_i / 10.0
        for z_i in range(-22, 23, 3):
            z = z_i / 10.0
            # Check if in water damage zone
            if -1.8 <= x <= 1.8 and -1.4 <= z <= 1.4:
                # Cyan/blue wet points
                r, g, b = 14, 165, 233
            else:
                # Slate floor points
                r, g, b = 71, 85, 105
            points.append((x, 0.0, z, r, g, b))

    # 2. Wall perimeter points (various heights Y from 0.0 to 2.5)
    for y_i in range(0, 26, 3):
        y = y_i / 10.0
        # Wall 1 (Z = -2.25)
        for x_i in range(-27, 28, 2):
            points.append((x_i / 10.0, y, -2.25, 226, 232, 240))
        # Wall 3 (Z = +2.25)
        for x_i in range(-27, 28, 2):
            points.append((x_i / 10.0, y, 2.25, 226, 232, 240))
        # Wall 4 (X = -2.7)
        for z_i in range(-22, 23, 2):
            points.append((-2.7, y, z_i / 10.0, 203, 213, 225))
        # Wall 2 (X = +2.7)
        for z_i in range(-22, 23, 2):
            if not (0.2 <= y <= 2.1 and -0.5 <= (z_i / 10.0) <= 0.5):  # Door gap
                points.append((2.7, y, z_i / 10.0, 203, 213, 225))

    header = f"""ply
format ascii 1.0
element vertex {len(points)}
property float x
property float y
property float z
property uchar red
property uchar green
property uchar blue
end_header
"""
    lines = [f"{p[0]:.3f} {p[1]:.3f} {p[2]:.3f} {p[3]} {p[4]} {p[5]}" for p in points]
    out_path.write_text(header + "\n".join(lines) + "\n")


async def seed_demo_pipeline(db: AsyncSession, rag_engine) -> dict:
    """
    Seed a complete demo 3D reconstruction job and linked claim with HO-3 policy.
    Enables instant closed-loop testing directly from the UI.
    """
    # 1. Seed or retrieve Job
    res = await db.execute(select(Job).where(Job.id == DEMO_JOB_ID))
    job = res.scalar_one_or_none()

    results_dir = get_results_dir(DEMO_JOB_ID)
    svg_path = results_dir / "floor_plan.svg"
    ply_path = results_dir / "point_cloud.ply"

    generate_demo_svg(svg_path)
    generate_demo_ply(ply_path)

    result_payload = {
        "scale_confidence": "native_metric",
        "room_area_m2": 24.5,
        "wall_count": 4,
        "damage_area_m2": 18.2,
        "walls": [
            {"id": 1, "length_m": 5.40, "start": [0.0, 0.0], "end": [5.4, 0.0], "has_opening": False, "opening_type": None},
            {"id": 2, "length_m": 4.50, "start": [5.4, 0.0], "end": [5.4, 4.5], "has_opening": True, "opening_type": "door"},
            {"id": 3, "length_m": 5.40, "start": [5.4, 4.5], "end": [0.0, 4.5], "has_opening": True, "opening_type": "window"},
            {"id": 4, "length_m": 4.50, "start": [0.0, 4.5], "end": [0.0, 0.0], "has_opening": False, "opening_type": None},
        ],
        "error_estimate": {
            "method": "LiDAR native mesh validation",
            "expected_wall_error_cm": 0.8
        },
        "files": {
            "floor_plan_svg": "floor_plan.svg",
            "point_cloud_ply": "point_cloud.ply",
        }
    }

    if not job:
        job = Job(
            id=DEMO_JOB_ID,
            tier=Tier.lidar,
            is_demo=True,
            room_area_m2=24.5,
            wall_count=4,
            status=JobStatus.complete,
            result_payload=result_payload,
        )
        db.add(job)
    else:
        job.is_demo = True
        job.status = JobStatus.complete
        job.room_area_m2 = 24.5
        job.wall_count = 4
        job.result_payload = result_payload

    await db.commit()
    await db.refresh(job)

    # 2. Seed or retrieve Claim
    claim_res = await db.execute(select(Claim).where(Claim.id == DEMO_CLAIM_ID))
    claim = claim_res.scalar_one_or_none()

    claim_dir = get_claim_dir(DEMO_CLAIM_ID)
    dest_policy = claim_dir / "policy.pdf"

    if SAMPLE_POLICY_PATH.exists() and not dest_policy.exists():
        shutil.copyfile(SAMPLE_POLICY_PATH, dest_policy)

    if not claim:
        claim = Claim(
            id=DEMO_CLAIM_ID,
            job_id=DEMO_JOB_ID,
            status=ClaimStatus.created,
            property_type="residential",
            cause_of_loss="water",
            damage_description=(
                "Supply pipe ruptured beneath kitchen sink while occupants were away for the weekend. "
                "Flooding covered the kitchen and adjacent living room area, soaking lower drywall, "
                "baseboards, and hardwood flooring across approximately 18.2 m²."
            ),
            insurer_name="State Farm Fire and Casualty Company",
            policy_number="HO3-9948201-24",
            has_policy_pdf=dest_policy.exists(),
            policy_pdf_path=str(dest_policy) if dest_policy.exists() else None,
        )
        db.add(claim)
    else:
        claim.job_id = DEMO_JOB_ID
        claim.cause_of_loss = "water"
        claim.has_policy_pdf = dest_policy.exists()
        claim.policy_pdf_path = str(dest_policy) if dest_policy.exists() else None

    await db.commit()
    await db.refresh(claim)

    # 3. Index policy into ChromaDB if not already indexed
    ingest_stats = None
    if dest_policy.exists() and rag_engine:
        try:
            ingest_stats = rag_engine.ingest_policy(DEMO_CLAIM_ID, dest_policy)
            claim.status = ClaimStatus.policy_indexed
            await db.commit()
            await db.refresh(claim)
        except Exception as e:
            log.warning("demo_policy_ingest_skipped", error=str(e))

    return {
        "job_id": job.id,
        "claim_id": claim.id,
        "status": "seeded",
        "has_policy_pdf": claim.has_policy_pdf,
        "policy_indexed": claim.status == ClaimStatus.policy_indexed,
        "ingest_stats": ingest_stats,
    }
