import * as THREE from "three"
import type { AxisViewPreset, CompassPoint, ViewPreset } from "./viewerTypes"

export const AXIS_VIEW_BUTTONS: Array<{
  preset: AxisViewPreset
  label: string
  className: string
  direction: THREE.Vector3
}> = [
  {
    preset: "x+",
    label: "X+",
    className: "axis-x-plus",
    direction: new THREE.Vector3(1, 0, 0),
  },
  {
    preset: "x-",
    label: "X-",
    className: "axis-x-minus",
    direction: new THREE.Vector3(-1, 0, 0),
  },
  {
    preset: "y+",
    label: "Y+",
    className: "axis-y-plus",
    direction: new THREE.Vector3(0, 1, 0),
  },
  {
    preset: "y-",
    label: "Y-",
    className: "axis-y-minus",
    direction: new THREE.Vector3(0, -1, 0),
  },
  {
    preset: "z+",
    label: "Z+",
    className: "axis-z-plus",
    direction: new THREE.Vector3(0, 0, 1),
  },
  {
    preset: "z-",
    label: "Z-",
    className: "axis-z-minus",
    direction: new THREE.Vector3(0, 0, -1),
  },
]

export function getCompassPoints(
  camera: THREE.Camera,
): Record<AxisViewPreset, CompassPoint> {
  const inverseCameraRotation = camera.quaternion.clone().invert()
  const points = {} as Record<AxisViewPreset, CompassPoint>

  for (const axis of AXIS_VIEW_BUTTONS) {
    const projected = axis.direction
      .clone()
      .applyQuaternion(inverseCameraRotation)
    points[axis.preset] = {
      x: projected.x,
      y: -projected.y,
      z: projected.z,
    }
  }

  return points
}

export function areCompassPointsEqual(
  a: Record<AxisViewPreset, CompassPoint> | null,
  b: Record<AxisViewPreset, CompassPoint>,
) {
  if (!a) {
    return false
  }

  return AXIS_VIEW_BUTTONS.every((axis) => {
    const current = a[axis.preset]
    const next = b[axis.preset]
    return (
      Math.abs(current.x - next.x) < 0.001 &&
      Math.abs(current.y - next.y) < 0.001 &&
      Math.abs(current.z - next.z) < 0.001
    )
  })
}

export function AxisCompass({
  compassPoints,
  viewPreset,
  onViewPresetChange,
}: {
  compassPoints: Record<AxisViewPreset, CompassPoint> | null
  viewPreset: ViewPreset
  onViewPresetChange: (viewPreset: ViewPreset) => void
}) {
  return (
    <div className="axis-compass" aria-label="Axis camera compass">
      {[...AXIS_VIEW_BUTTONS]
        .sort((a, b) => {
          const aPoint = compassPoints?.[a.preset]
          const bPoint = compassPoints?.[b.preset]
          return (aPoint?.z ?? 0) - (bPoint?.z ?? 0)
        })
        .map((axis) => {
          const point = compassPoints?.[axis.preset] ?? {
            x: axis.direction.x,
            y: -axis.direction.y,
            z: axis.direction.z,
          }
          const radius = 28
          const depth = (point.z + 1) / 2

          return (
            <button
              key={axis.preset}
              type="button"
              className={`${axis.className} ${
                viewPreset === axis.preset ? "is-active" : ""
              }`}
              style={{
                left: `${34 + point.x * radius}px`,
                top: `${34 + point.y * radius}px`,
                opacity: 0.46 + depth * 0.54,
                transform: `scale(${0.72 + depth * 0.24})`,
                zIndex: Math.round(depth * 10),
              }}
              title={`View ${axis.label}`}
              aria-label={`View ${axis.label}`}
              onClick={() => onViewPresetChange(axis.preset)}
            >
              {axis.label}
            </button>
          )
        })}
      <button
        type="button"
        className={`axis-center ${viewPreset === "corner" ? "is-active" : ""}`}
        title="Corner view"
        aria-label="Corner view"
        onClick={() => onViewPresetChange("corner")}
      />
    </div>
  )
}
