import type { ProjectionMode, ViewPreset } from "./viewerTypes"

export function ViewportToolbar({
  projection,
  viewPreset,
  onFit,
  onProjectionToggle,
  onViewPresetChange,
}: {
  projection: ProjectionMode
  viewPreset: ViewPreset
  onFit: () => void
  onProjectionToggle: () => void
  onViewPresetChange: (viewPreset: ViewPreset) => void
}) {
  return (
    <div className="viewport-actions">
      <button
        type="button"
        className={viewPreset === "x+" ? "is-active" : undefined}
        onClick={() => onViewPresetChange("x+")}
      >
        Side
      </button>
      <button
        type="button"
        className={viewPreset === "y+" ? "is-active" : undefined}
        onClick={() => onViewPresetChange("y+")}
      >
        Front
      </button>
      <button
        type="button"
        className={viewPreset === "z+" ? "is-active" : undefined}
        onClick={() => onViewPresetChange("z+")}
      >
        Top
      </button>
      <button
        type="button"
        className={viewPreset === "corner" ? "is-active" : undefined}
        onClick={() => onViewPresetChange("corner")}
      >
        Corner
      </button>
      <button type="button" className="projection-toggle" onClick={onFit}>
        Fit
      </button>
      <button
        type="button"
        className="projection-toggle"
        onClick={onProjectionToggle}
      >
        {projection === "perspective" ? "Orthographic" : "Perspective"}
      </button>
    </div>
  )
}
