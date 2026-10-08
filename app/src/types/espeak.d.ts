/** @echogarden/espeak-ng-emscripten 没有自带类型声明（GPL-3.0 的 emscripten 构建） */
declare module '@echogarden/espeak-ng-emscripten' {
  interface ESpeakNGWorker {
    synthesize(text: string, cb: (data: Int16Array) => boolean): void
    set_voice(voice: string): void
    set_rate(rate: number): void
    set_pitch(pitch: number): void
    get_samplerate(): number
  }
  interface ESpeakNGModule {
    eSpeakNGWorker: new () => ESpeakNGWorker
  }
  const factory: (arg?: { locateFile?: (path: string) => string }) => Promise<ESpeakNGModule>
  export default factory
}
