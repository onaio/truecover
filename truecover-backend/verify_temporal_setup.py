#!/usr/bin/env python3
"""
Verify that all Temporal workflows and activities are properly configured.
This script checks that imports work and activities are discoverable.
"""

import sys

print("=" * 70)
print("TEMPORAL SETUP VERIFICATION")
print("=" * 70)

# Test imports
print("\n1. Testing workflow imports...")
try:
    from temporal.workflows.location_upload import LocationUploadWorkflow
    print("   ✓ LocationUploadWorkflow")
except Exception as e:
    print(f"   ✗ LocationUploadWorkflow: {e}")
    sys.exit(1)

try:
    from temporal.workflows.overture_import import OvertureImportWorkflow
    print("   ✓ OvertureImportWorkflow")
except Exception as e:
    print(f"   ✗ OvertureImportWorkflow: {e}")
    sys.exit(1)

try:
    from temporal.workflows.coverage_prediction import CoveragePredictionWorkflow
    print("   ✓ CoveragePredictionWorkflow")
except Exception as e:
    print(f"   ✗ CoveragePredictionWorkflow: {e}")
    sys.exit(1)

try:
    from temporal.workflows.pixel_enrichment import PixelEnrichmentWorkflow
    print("   ✓ PixelEnrichmentWorkflow")
except Exception as e:
    print(f"   ✗ PixelEnrichmentWorkflow: {e}")
    sys.exit(1)

try:
    from temporal.workflows.round_generation import RoundGenerationWorkflow
    print("   ✓ RoundGenerationWorkflow")
except Exception as e:
    print(f"   ✗ RoundGenerationWorkflow: {e}")
    sys.exit(1)

try:
    from temporal.workflows.pixel_generation import PixelGenerationWorkflow
    print("   ✓ PixelGenerationWorkflow")
except Exception as e:
    print(f"   ✗ PixelGenerationWorkflow: {e}")
    sys.exit(1)

print("\n2. Testing activity module imports...")
try:
    from temporal.activities import locations
    print("   ✓ locations activities")
except Exception as e:
    print(f"   ✗ locations activities: {e}")
    sys.exit(1)

try:
    from temporal.activities import overture
    print("   ✓ overture activities")
except Exception as e:
    print(f"   ✗ overture activities: {e}")
    sys.exit(1)

try:
    from temporal.activities import coverage
    print("   ✓ coverage activities")
except Exception as e:
    print(f"   ✗ coverage activities: {e}")
    sys.exit(1)

try:
    from temporal.activities import enrichment
    print("   ✓ enrichment activities")
except Exception as e:
    print(f"   ✗ enrichment activities: {e}")
    sys.exit(1)

try:
    from temporal.activities import rounds
    print("   ✓ rounds activities")
except Exception as e:
    print(f"   ✗ rounds activities: {e}")
    sys.exit(1)

try:
    from temporal.activities import pixels
    print("   ✓ pixels activities")
except Exception as e:
    print(f"   ✗ pixels activities: {e}")
    sys.exit(1)

print("\n3. Discovering activities...")
try:
    from temporal_worker import discover_activities

    activity_counts = {
        'locations': len(discover_activities(locations)),
        'overture': len(discover_activities(overture)),
        'coverage': len(discover_activities(coverage)),
        'enrichment': len(discover_activities(enrichment)),
        'rounds': len(discover_activities(rounds)),
        'pixels': len(discover_activities(pixels)),
    }

    total = sum(activity_counts.values())

    for module_name, count in activity_counts.items():
        print(f"   ✓ {module_name}: {count} activities")

    print(f"\n   Total: {total} activities discovered")

except Exception as e:
    print(f"   ✗ Activity discovery failed: {e}")
    sys.exit(1)

print("\n4. Testing route imports...")
try:
    from routes.coverage import coverage_bp
    print("   ✓ coverage routes")
except Exception as e:
    print(f"   ✗ coverage routes: {e}")
    sys.exit(1)

try:
    from routes.enrichment import enrichment_bp
    print("   ✓ enrichment routes")
except Exception as e:
    print(f"   ✗ enrichment routes: {e}")
    sys.exit(1)

try:
    from routes.rounds import rounds_bp
    print("   ✓ rounds routes")
except Exception as e:
    print(f"   ✗ rounds routes: {e}")
    sys.exit(1)

print("\n" + "=" * 70)
print("✓ ALL CHECKS PASSED - Temporal setup is ready!")
print("=" * 70)

print("\nNext steps:")
print("1. Run database migration: psql < db/migrations/add_workflow_id_to_enrichment_jobs.sql")
print("2. Start Temporal server: docker-compose up -d temporal temporal-ui")
print("3. Start worker: uv run python temporal_worker.py")
print("4. Test workflows using the examples in TEMPORAL_MIGRATION_COMPLETE.md")
print()
