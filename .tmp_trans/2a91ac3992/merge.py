# -*- coding: utf-8 -*-
"""Assemble batch-2a91ac3992 output.

Alignment contract (index -> input item):
  cur[0:3]    -> items 0..2
  ITEM3       -> item 3            (omitted in first pass, added here)
  cur[3:22]   -> items 4..22
  cur[22]+cur[23] -> item 23       (was split in two: verses + Pythia's reply)
  cur[24:]    -> items 24..121
"""
import importlib.util, json, os

BASE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(BASE, "..", ".."))

def load(name):
    p = os.path.join(BASE, name)
    spec = importlib.util.spec_from_file_location("m_" + name[:-3], p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.ZH

cur = load("part1.py") + load("part2.py") + load("part3.py")
assert len(cur) == 122, len(cur)

ITEM3 = (
    "此后，克勒奥墨涅斯把大部分军队遣回斯巴达，自己带了一千名精锐前往赫拉神庙献祭。"
    "他要献祭时，祭司禁止他上祭坛，说外邦人在那里献祭不合神律。"
    "克勒奥墨涅斯便命令希洛人把祭司从祭坛拖开去鞭打，自己献了祭；"
    "做完这些，他就返回斯巴达。"
)

zh = cur[0:3] + [ITEM3] + cur[3:22] + [cur[22] + cur[23]] + cur[24:]
assert len(zh) == 122, len(zh)

src = json.load(open(os.path.join(ROOT, "data/zh_reading/batches/batch-2a91ac3992.json"), encoding="utf-8"))

# anchor checks against known source content
assert src[3]["g"].startswith("μετὰ δὲ ταῦτα ὁ Κλεομένης τὴν μὲν πλέω")
assert zh[3].startswith("此后，克勒奥墨涅斯把大部分军队")
assert zh[4].startswith("他回国后") and src[4]["g"].startswith("νοστήσαντα")
assert zh[22].startswith("米利都人把这当作一场灾祸") and src[22]["g"].startswith("οἱ μὲν δὴ Μιλήσιοι")
assert zh[23].startswith("“格劳科斯，埃皮库德斯的儿子") and "试探神与真做那件事" in zh[23]
assert src[23]["g"].startswith("γλαῦκʼ Ἐπικυδείδη")
assert zh[24].startswith("格劳科斯于是把米利都客人召来") and src[24]["g"].startswith("Γλαῦκος μὲν δὴ μεταπεμψάμενος")
assert zh[121].startswith("这些就是在大陆上行进") and src[121]["g"].startswith("ταῦτα ἦν τὰ κατʼ ἤπειρον")

out = [{"k": it["k"], "zh": z} for it, z in zip(src, zh)]
assert len(out) == 122 and len(set(o["k"] for o in out)) == 122
assert [o["k"] for o in out] == [it["k"] for it in src]
assert all(o["zh"].strip() for o in out)

dst = os.path.join(ROOT, "data/zh_reading/out/batch-2a91ac3992.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)
with open(dst, "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
    f.write("\n")
print("wrote", dst, "items:", len(out))
