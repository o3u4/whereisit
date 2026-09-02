import os
import tempfile
from pathlib import Path

# Point the app at a throwaway data dir BEFORE any app module is imported,
# because core.config resolves paths at import time.
_TEST_DATA = Path(tempfile.mkdtemp(prefix="whereisit_test_"))
os.environ["WHEREISIT_DATA_DIR"] = str(_TEST_DATA)
