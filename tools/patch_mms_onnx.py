#!/usr/bin/env python3
"""把 MMS-TTS 的随机时长预测器改为确定性。

为什么必须改：VITS 的时长预测器里有两个 ``RandomNormalLike``，
每次推理都抽新的噪声。实测同一句话连合成 5 次，时长在 3.06–3.58 秒之间
浮动（**极差 15.8%**）。这本身就是「节奏乱」的来源之一；而一旦把句子
切段分别合成，每段各自随机，接起来的节奏就完全散了。

做法：把这两个随机节点替换成同形状的全零常量。
零噪声对应时长分布的均值，实测输出稳定且清晰，同时让合成结果
**可复现**——同样的文本必得同样的音频，缓存与预生成才有意义。

用法:
    python3 tools/patch_mms_onnx.py <输入.onnx> <输出.onnx> [只替换名字含此串的节点]
"""
from __future__ import annotations

import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


def patch(src: str, dst: str, only: str | None = None) -> None:
    """把 RandomNormalLike 换成「形状取自输入、值全为 0」的常量。

    不依赖静态形状：Shape(input) → ConstantOfShape，形状在运行时确定。
    """
    model = onnx.load(src)
    graph = model.graph

    new_nodes = []
    inits = list(graph.initializer)
    replaced = 0
    for node in graph.node:
        if node.op_type not in ("RandomNormalLike", "RandomNormal"):
            new_nodes.append(node)
            continue
        name = node.name or node.output[0]
        # only 用于只替换指定的那个随机节点：时长预测器的噪声影响「节奏」，
        # 而波形先验噪声影响「音色」，两者要分开评估，不能一起改。
        if only and only not in name:
            new_nodes.append(node)
            continue
        src_tensor = node.input[0]
        shape_name = f"{node.output[0]}_shape"
        new_nodes.append(helper.make_node("Shape", [src_tensor], [shape_name],
                                          name=f"{node.name}_shape"))
        new_nodes.append(helper.make_node(
            "ConstantOfShape", [shape_name], [node.output[0]],
            name=f"{node.name}_det",
            value=numpy_helper.from_array(np.zeros(1, dtype=np.float32), "value")))
        replaced += 1
        print(f"  {(node.name or node.output[0])[:70]}: 输入 {src_tensor[:50]} → 全零")

    if replaced == 0:
        print("没有随机节点，无需修改")
        onnx.save(model, dst)
        return

    del graph.node[:]
    graph.node.extend(new_nodes)
    del graph.initializer[:]
    graph.initializer.extend(inits)
    onnx.save(model, dst)
    print(f"已替换 {replaced} 个随机节点 → {dst}")


if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        print(__doc__)
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else None)
