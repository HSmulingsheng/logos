/**
 * 构建期开关。
 *
 * USE_TTS：是否在浏览器里打包 eSpeak-NG 用于实时合成例句发音。
 *   eSpeak-NG 是 GPL-3.0，随应用分发会把整体置于 GPL-3.0（见项目根 LICENSE）。
 *   若不想采用 GPL，把这里改成 false 重建即可——例句发音会退回系统语音，
 *   其余功能不受影响。
 */
export const USE_TTS = true
