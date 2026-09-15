# Insurance Claim Report

## Claim Details

- **Claim ID:** 6e7c0c94-ffcb-49fc-b4cb-ef7d28f3c20c
- **Policyholder:** Jane Doe
- **Policy Number:** POL-123
- **Property Address:** 123 Main St
- **Incident Type:** Water damage
- **Incident Description:** Test claim via test_claim.sh

## Reconstruction Summary

- **Floor Area:** 0.00 m²
- **Wall Segments:** 0
- **Scale Confidence:** scaled_via_reference

## Reconstruction Artifacts

Verify these outputs manually (host paths are under `backend/data/`):

- **Floor Plan SVG:** `c15036c7-f6a6-4414-8d39-e0fcb28469e0/results/floor_plan.svg`
- **Floor Plan DXF (CAD):** `c15036c7-f6a6-4414-8d39-e0fcb28469e0/results/floor_plan.dxf`
- **3D Point Cloud (PLY):** `c15036c7-f6a6-4414-8d39-e0fcb28469e0/results/scan_metric.ply`
- **Validation CSV:** `c15036c7-f6a6-4414-8d39-e0fcb28469e0/results/validation.csv`

Download endpoints: `/jobs/c15036c7-f6a6-4414-8d39-e0fcb28469e0/files/<filename>`

## Damage Assessment

- **Severity:** none
- **Affected Area:** N/A
- **Damage Types:** None reported
- **Estimated Loss Band:** None

### Repair Scope

No repairs required

## Suggested Next Steps

- An adjuster should review the reconstruction outputs and photos.
- Confirm the damage assessment against the 3D point cloud and floor plan.
- Update this report with any policy-specific coverage determinations.

## Raw Assessment JSON

```json
{
  "damage_types": [],
  "affected_area_m2": null,
  "severity": "none",
  "repair_scope": "No repairs required",
  "estimated_loss_band": "None"
}
```

