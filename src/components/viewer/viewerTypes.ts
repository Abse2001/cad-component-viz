export type ProjectionMode = "perspective" | "orthographic"
export type AxisViewPreset = "x+" | "x-" | "y+" | "y-" | "z+" | "z-"
export type ViewPreset = AxisViewPreset | "corner"

export type CompassPoint = {
  x: number
  y: number
  z: number
}
