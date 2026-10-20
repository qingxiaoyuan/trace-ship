"""镜像内真正编译与打包虚构软件；不联网、不访问业务凭据。"""

import compileall
import hashlib
import json
import os
import shutil
import zipapp
from pathlib import Path

source = Path(os.environ["SOURCE_DIR"])
artifacts = Path(os.environ["ARTIFACTS_DIR"])
app = source / "application"
if not compileall.compile_dir(app, quiet=1):
    raise RuntimeError("虚构软件编译失败")
zipapp.create_archive(app, target=artifacts / "software.pyz", interpreter="/usr/bin/env python3")
identity = {
    "version": os.environ["VERSION"],
    "tag": os.environ["TAG_NAME"],
    "project_code": os.environ["PROJECT_CODE"],
    "commit": (source / ".git" / "HEAD").read_text().strip(),
    "sample": (source / "sample.txt").read_text().strip(),
    "app_sha256": hashlib.sha256((artifacts / "software.pyz").read_bytes()).hexdigest(),
}
(artifacts / "build-info.json").write_text(json.dumps(identity, ensure_ascii=False), encoding="utf-8")
shutil.copyfile(os.environ["RELEASE_DOC_PATH"], artifacts / "release.md")
print("真实 Docker 编译和 zipapp 打包完成", flush=True)
