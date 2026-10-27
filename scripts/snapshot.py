"""Deterministic compressed static snapshot transport; raw JSON is local-only."""
import gzip
import json
import os
from pathlib import Path
import tempfile


def read_snapshot(path):
    path=Path(path)
    if path.suffix=='.gz': return json.loads(gzip.decompress(path.read_bytes()))
    if path.exists(): return json.loads(path.read_text())
    compressed=Path(str(path)+'.gz')
    if compressed.exists(): return json.loads(gzip.decompress(compressed.read_bytes()))
    return None


def write_compressed(path,data):
    path=Path(path)
    if path.suffix!='.gz': path=Path(str(path)+'.gz')
    path.parent.mkdir(parents=True,exist_ok=True)
    raw=json.dumps(data,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    packed=gzip.compress(raw,compresslevel=9,mtime=0)
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.snapshot-')
    try:
        with os.fdopen(fd,'wb') as out:
            out.write(packed);out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp): os.unlink(tmp)
    return path
