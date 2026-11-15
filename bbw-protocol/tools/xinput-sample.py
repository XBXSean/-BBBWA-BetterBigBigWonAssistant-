#!/usr/bin/env python
"""xinput-sample.py —— 用 Windows XInput 读标准手柄状态,输出 JSON。

比逆向 IG_00 的私有报告可靠:LT/RT 是文档化的 0..255,摇杆 ±32767。
用法: python tools/xinput-sample.py [--ms 600] [--index 0]
"""
import ctypes
import json
import sys
import time
from ctypes import wintypes


class XINPUT_GAMEPAD(ctypes.Structure):
    _fields_ = [
        ("wButtons", wintypes.WORD),
        ("bLeftTrigger", ctypes.c_ubyte),
        ("bRightTrigger", ctypes.c_ubyte),
        ("sThumbLX", ctypes.c_short),
        ("sThumbLY", ctypes.c_short),
        ("sThumbRX", ctypes.c_short),
        ("sThumbRY", ctypes.c_short),
    ]


class XINPUT_STATE(ctypes.Structure):
    _fields_ = [("dwPacketNumber", wintypes.DWORD), ("Gamepad", XINPUT_GAMEPAD)]


def load_xinput():
    for name in ("xinput1_4.dll", "xinput1_3.dll", "xinput9_1_0.dll"):
        try:
            return ctypes.WinDLL(name)
        except OSError:
            continue
    raise RuntimeError("找不到 xinput dll")


def main():
    ms = 600
    index = None  # None = 自动探测(设备重枚举后槽位会变,见下)
    args = sys.argv[1:]
    for i, a in enumerate(args):
        if a == "--ms" and i + 1 < len(args):
            ms = int(args[i + 1])
        if a == "--index" and i + 1 < len(args):
            index = int(args[i + 1])

    lib = load_xinput()
    lib.XInputGetState.argtypes = [wintypes.DWORD, ctypes.POINTER(XINPUT_STATE)]
    lib.XInputGetState.restype = wintypes.DWORD

    st = XINPUT_STATE()
    if index is None:
        # 写 [304] 之类会让设备重枚举,XInput 槽位可能从 0 跳到 1,故显式探测
        for cand in range(4):
            if lib.XInputGetState(cand, ctypes.byref(st)) == 0:
                index = cand
                break
        if index is None:
            print(json.dumps({"error": "4 个槽位都没有手柄"}))
            return 1
    if lib.XInputGetState(index, ctypes.byref(st)) != 0:
        print(json.dumps({"error": f"index {index} 无连接手柄"}))
        return 1

    keys = ["lt", "rt", "lx", "ly", "rx", "ry"]
    agg = {k: {"min": None, "max": None, "last": None} for k in keys}
    series = {k: [] for k in keys}
    buttons_or = 0
    samples = 0
    t0 = time.time()
    while (time.time() - t0) * 1000 < ms:
        if lib.XInputGetState(index, ctypes.byref(st)) != 0:
            continue
        g = st.Gamepad
        vals = {
            "lt": g.bLeftTrigger, "rt": g.bRightTrigger,
            "lx": g.sThumbLX, "ly": g.sThumbLY,
            "rx": g.sThumbRX, "ry": g.sThumbRY,
        }
        buttons_or |= g.wButtons
        for k, v in vals.items():
            a = agg[k]
            a["min"] = v if a["min"] is None else min(a["min"], v)
            a["max"] = v if a["max"] is None else max(a["max"], v)
            a["last"] = v
            series[k].append(v)
        samples += 1
        time.sleep(0.008)

    # 中位数比 (min+max)/2 抗瞬态抖动: 皮筋/手抖造成的偶发跳变不会污染结果
    def pct(xs, q):
        if not xs:
            return None
        s = sorted(xs)
        i = min(len(s) - 1, max(0, int(round(q * (len(s) - 1)))))
        return s[i]

    for k in keys:
        xs = series[k]
        agg[k]["med"] = pct(xs, 0.5)
        agg[k]["p05"] = pct(xs, 0.05)
        agg[k]["p95"] = pct(xs, 0.95)

    agg["buttons"] = buttons_or
    agg["samples"] = samples
    print(json.dumps(agg, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
