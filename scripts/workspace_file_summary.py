"""Bounded previews of uploaded research files. Raw files remain available to tools."""
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
extension = path.suffix.lower()
if extension == ".pdf":
    from pypdf import PdfReader
    reader = PdfReader(path)
    result = {"pages": len(reader.pages), "preview": "\n".join((page.extract_text() or "")[:5000] for page in reader.pages[:8])[:25000]}
elif extension in (".csv", ".xls", ".xlsx"):
    import pandas as pd
    frame = pd.read_csv(path, nrows=20) if extension == ".csv" else pd.read_excel(path, nrows=20)
    result = {"columns": list(map(str, frame.columns)), "sample_only": True, "rows": frame.to_json(orient="records", force_ascii=False)}
elif extension in (".tif", ".tiff"):
    import rasterio
    with rasterio.open(path) as dataset:
        result = {"width": dataset.width, "height": dataset.height, "bands": dataset.count, "crs": str(dataset.crs), "bounds": list(dataset.bounds), "dtypes": dataset.dtypes, "nodata": dataset.nodata}
elif extension == ".geojson":
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    features = data.get("features", [])
    result = {"type": data.get("type"), "feature_count": len(features), "crs": data.get("crs"), "sample": features[:3] if features else data}
else:
    raise ValueError("Unsupported file type")
print(json.dumps(result, ensure_ascii=False, default=str)[:30000])
