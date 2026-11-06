#!/usr/bin/env bash
# 安装：带原版图标的 Dock 启动器 + 文生图/局部编辑小应用 + 系统服务
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APPS_DIR="$HOME/Applications/PhotoCraft Bridge"
SERVICES_DIR="$HOME/Library/Services"
ICON="/Applications/PhotoCraft.app/Contents/Resources/PhotoCraft.icns"

chmod +x "$ROOT"/scripts/*.sh
mkdir -p "$APPS_DIR" "$SERVICES_DIR"

make_app() {
  local name="$1"
  local script="$2"
  local app="$APPS_DIR/$name.app"
  local tmp
  rm -rf "$app"
  tmp="$(mktemp /tmp/pcbridge-XXXXXX.applescript)"
  cat >"$tmp" <<APPLESCRIPT
on run
  set sh to "bash " & quoted form of "$script" & " >/tmp/photocraft-bridge-last.log 2>&1"
  try
    do shell script sh
  on error errMsg
    display alert "PhotoCraft 桥失败" message errMsg as critical
  end try
end run
APPLESCRIPT
  osacompile -o "$app" "$tmp"
  rm -f "$tmp"
  if [[ -f "$ICON" ]]; then
    mkdir -p "$app/Contents/Resources"
    cp "$ICON" "$app/Contents/Resources/applet.icns"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile applet" "$app/Contents/Info.plist" 2>/dev/null \
      || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string applet" "$app/Contents/Info.plist" 2>/dev/null \
      || true
    # 刷新图标缓存
    touch "$app"
  fi
  echo "installed app: $app"
}

# 主启动器：日常只放这一个到 Dock，替代「特殊脚本启动」
make_app "PhotoCraft AI" "$ROOT/scripts/ensure-stack.sh"
make_app "PhotoCraft 文生图" "$ROOT/scripts/run-generate.sh"
make_app "PhotoCraft 局部编辑" "$ROOT/scripts/run-edit.sh"

# 去掉旧名字，避免 Dock 里一堆重复入口
rm -rf "$APPS_DIR/启动 PhotoCraft(桥).app"

install_service() {
  local title="$1"
  local script="$2"
  local bundle="$3"
  local wf="$SERVICES_DIR/$title.workflow"
  rm -rf "$wf"
  mkdir -p "$wf/Contents"

  cat >"$wf/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>${bundle}</string>
  <key>CFBundleName</key>
  <string>${title}</string>
  <key>NSServices</key>
  <array>
    <dict>
      <key>NSMenuItem</key>
      <dict>
        <key>default</key>
        <string>${title}</string>
      </dict>
      <key>NSMessage</key>
      <string>runWorkflowAsService</string>
      <key>NSRequiredContext</key>
      <dict>
        <key>NSApplicationIdentifier</key>
        <string>ai.storyteller.photocraft</string>
      </dict>
    </dict>
  </array>
</dict>
</plist>
PLIST

  TITLE="$title" SCRIPT="$script" WF="$wf" python3 - <<'PY'
import os, plistlib
from pathlib import Path
script = os.environ["SCRIPT"]
wf = Path(os.environ["WF"])
cmd = f"""#!/bin/bash
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:$PATH"
bash {script!r}
"""
doc = {
    "OSType": "amtr",
    "actions": [{
        "action": "com.apple.RunShellScript",
        "actionName": "Run Shell Script",
        "actionBundlePath": "/System/Library/Automator/Run Shell Script.action",
        "values": {
            "COMMAND_STRING": cmd,
            "inputMethod": 0,
            "shell": "/bin/bash",
            "source": "",
            "CheckedForUserDefaultShell": True,
        },
        "isViewVisible": 1,
    }],
    "connectors": {},
    "workflowMetaData": {
        "serviceInputTypeIdentifier": "com.apple.Automator.nothing",
        "serviceOutputTypeIdentifier": "com.apple.Automator.nothing",
        "serviceApplicationBundleID": "ai.storyteller.photocraft",
        "serviceApplicationPath": "/Applications/PhotoCraft.app",
        "serviceProcessesCanInput": False,
        "workflowType": "Service",
    },
}
(wf / "Contents/document.wflow").write_bytes(plistlib.dumps(doc))
print(f"installed service: {wf}")
PY
}

install_service "PhotoCraft 文生图" "$ROOT/scripts/run-generate.sh" "dev.peinan.photocraft-bridge.generate"
install_service "PhotoCraft 局部编辑" "$ROOT/scripts/run-edit.sh" "dev.peinan.photocraft-bridge.edit"

python3 - <<'PY'
import plistlib, subprocess, tempfile
from pathlib import Path
try:
    raw = subprocess.check_output(["defaults", "export", "pbs", "-"], stderr=subprocess.DEVNULL)
    data = plistlib.loads(raw) if raw.strip() else {}
except Exception:
    data = {}
status = dict(data.get("NSServicesStatus") or {})
for title, key in [("PhotoCraft 文生图", "@~g"), ("PhotoCraft 局部编辑", "@~e")]:
    for cand in [
        f"(null) - {title} - runWorkflowAsService",
        f"PhotoCraft.app - {title} - runWorkflowAsService",
        title,
    ]:
        status[cand] = {
            "enabled_context_menu": False,
            "enabled_services_menu": True,
            "key_equivalent": key,
        }
data["NSServicesStatus"] = status
with tempfile.NamedTemporaryFile(suffix=".plist", delete=False) as f:
    path = Path(f.name)
    path.write_bytes(plistlib.dumps(data))
subprocess.run(["defaults", "import", "pbs", str(path)], check=False)
path.unlink(missing_ok=True)
PY

open "$APPS_DIR"

cat <<EOF

已更新启动方式（更省事）：

1) 把 「PhotoCraft AI」拖进 Dock，平时只点它
   （原版图标；自动拉起 image-editor + 带 control 的 PhotoCraft）
   $APPS_DIR/PhotoCraft AI.app

2) 点「文生图 / 局部编辑」时同样会自动确保两端都已就绪

3) 快捷键（PhotoCraft 前台）：⌘⌥G 文生图，⌘⌥E 局部编辑
EOF
