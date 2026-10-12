#!/usr/bin/env python3
"""
实验：能否把 NLLB-200 微调成「古希腊语 → 中文」翻译模型？

背景
----
用户问「古希腊语的机器翻译模型能不能从无到有创造」。
- 从零训练：不现实。平行语料只有新约的 7,927 对（工业级起步 10 万对以上），
  且**古典希腊语↔中文的平行语料为零**（中文译本都在版权保护期内）。
- 但**迁移学习**可能可行：NLLB 有现代希腊语（ell_Grek），与现代/通用希腊语
  词形接近，零样本实测已能译出可读中文（ὁ δὲ Ἰησοῦς ἔκλαυσεν → 「耶稣就哭了」）。

本脚本做决定性验证：在同一验证集上比较**零样本**与**微调后**的 chrF。

用法（需 MPS 或 CUDA；CPU 会非常慢）：
    HF_HOME=$PWD/.hf-cache tools/venvs/mt-exp/bin/python tools/mt_experiment.py
    ... --steps 300 --eval-every 100
"""
from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import torch
from sacrebleu.metrics import CHRF
from torch.utils.data import DataLoader
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data/_mt_exp.json"
MODEL_ID = "facebook/nllb-200-distilled-600M"
SRC_LANG = "ell_Grek"      # 用现代希腊语当古希腊语的代理
TGT_LANG = "zho_Hans"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=8)
    ap.add_argument("--lr", type=float, default=2e-5)
    ap.add_argument("--epochs", type=float, default=1.0)
    ap.add_argument("--eval-every", type=int, default=200)
    ap.add_argument("--max-len", type=int, default=128)
    ap.add_argument("--dev-limit", type=int, default=120, help="评测用的验证集条数（控时间）")
    a = ap.parse_args()

    dev_name = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    print(f"设备：{dev_name}")
    dev = torch.device(dev_name)

    print("载入模型…")
    tok = AutoTokenizer.from_pretrained(MODEL_ID)
    tok.src_lang = SRC_LANG
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID)
    # 全量微调在这台 M4 上实测**慢到不可用**（单步十几分钟还没完），
    # 所以改用 LoRA：只训练注入的适配层，可训练参数降到 1%~2%，速度提升一个量级。
    lora = LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.05, bias="none",
        target_modules=["q_proj", "v_proj"],       # NLLB 的注意力投影
        task_type="SEQ_2_SEQ_LM",
    )
    model = get_peft_model(model, lora).to(dev)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    bos = tok.convert_tokens_to_ids(TGT_LANG)
    print(f"  LoRA：可训练 {trainable/1e6:.1f}M / 总共 {total/1e6:.0f}M（{trainable/total*100:.2f}%）")

    obj = json.load(open(DATA, encoding="utf-8"))
    train, heldout = obj["train"], obj["dev"][: a.dev_limit]

    def encode(batch):
        src = tok([g for g, _ in batch], return_tensors="pt", padding=True,
                  truncation=True, max_length=a.max_len).to(dev)
        with tok.as_target_tokenizer() if hasattr(tok, "as_target_tokenizer") else _null():
            tgt = tok(text_target=[z for _, z in batch], return_tensors="pt", padding=True,
                      truncation=True, max_length=a.max_len).to(dev)
        labels = tgt["input_ids"].clone()
        labels[labels == tok.pad_token_id] = -100
        src["labels"] = labels
        return src

    class _null:
        def __enter__(self): return None
        def __exit__(self, *x): return False

    @torch.no_grad()
    def evaluate(tag: str) -> float:
        model.eval()
        chrf = CHRF(word_order=2)
        hyps, refs = [], []
        for i in range(0, len(heldout), 8):
            chunk = heldout[i:i + 8]
            enc = tok([g for g, _ in chunk], return_tensors="pt", padding=True,
                      truncation=True, max_length=a.max_len).to(dev)
            out = model.generate(**enc, forced_bos_token_id=bos, max_new_tokens=96,
                                 num_beams=1, do_sample=False)
            hyps += [s.strip() for s in tok.batch_decode(out, skip_special_tokens=True)]
            refs += [z for _, z in chunk]
        score = chrf.corpus_score(hyps, [refs]).score
        print(f"  [{tag}] chrF = {score:.2f}")
        for k in range(2):
            print(f"     原文: {heldout[k][0][:46]}")
            print(f"     参考: {heldout[k][1][:34]}")
            print(f"     译文: {hyps[k][:34]}")
        model.train()
        return score

    print(f"\n训练 {len(train)} 对 · 验证 {len(heldout)} 对（取前 {a.dev_limit} 条评测）")
    base = evaluate("零样本")

    loader = DataLoader(train, batch_size=a.batch, shuffle=True, drop_last=True,
                        collate_fn=lambda b: b)   # 保持 [(grc, zh), ...] 结构
    opt = torch.optim.AdamW(model.parameters(), lr=a.lr)
    total_steps = int(len(loader) * a.epochs)
    print(f"\n开始微调：{total_steps} 步 · batch {a.batch} · lr {a.lr}")
    model.train()
    t0, step, run = time.time(), 0, 0.0
    for epoch in range(int(a.epochs) + 1):
        for batch in loader:
            enc = encode(batch)
            loss = model(**enc).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
            opt.zero_grad(set_to_none=True)
            run += float(loss.detach().cpu())
            step += 1
            if step % 50 == 0 or step == total_steps:
                el = time.time() - t0
                print(f"  步 {step}/{total_steps}  loss {run/50:.3f}  {el:.0f}s"
                      f"  预计剩余 {(total_steps-step)/(step/el)/60:.1f} 分钟", flush=True)
                run = 0.0
            if step % a.eval_every == 0:
                evaluate(f"第 {step} 步")
            if step >= total_steps:
                break
        if step >= total_steps:
            break

    final = evaluate("微调后")
    print(f"\n=== 结论 ===")
    print(f"  零样本 chrF {base:.2f} → 微调后 {final:.2f}（提升 {final-base:+.2f}）")
    print(f"  总耗时 {(time.time()-t0)/60:.1f} 分钟")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
