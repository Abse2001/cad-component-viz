import occtimportjs from "occt-import-js"
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url"

export type OcctModule = {
  ReadStepFile: (
    content: Uint8Array,
    params: object | null,
  ) => {
    success: boolean
    meshes: Array<{
      name: string
      color?: [number, number, number]
      brep_faces?: Array<{
        first: number
        last: number
        color: [number, number, number] | null
      }>
      attributes: {
        position: {
          array: number[]
        }
        normal?: {
          array: number[]
        }
      }
      index: {
        array: number[]
      }
    }>
  }
}

let modulePromise: Promise<OcctModule> | null = null

export function getOcctModule(): Promise<OcctModule> {
  if (!modulePromise) {
    modulePromise = occtimportjs({
      locateFile: (path: string) =>
        path.endsWith(".wasm") ? occtWasmUrl : path,
    }) as Promise<OcctModule>
  }
  return modulePromise
}
