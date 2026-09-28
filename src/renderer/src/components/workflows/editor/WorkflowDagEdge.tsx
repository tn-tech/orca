import React from 'react'
import { BaseEdge, getBezierPath, type Edge as FlowEdge, type EdgeProps } from '@xyflow/react'

export type WorkflowDagEdgeData = {
  /** Bend the path through this y instead of a straight bezier (`computeEdgeBendLanes`, F10):
   *  avoids the node(s) between source and target that a straight line would otherwise run
   *  behind (React Flow renders edges below nodes). */
  laneY?: number
}

export type WorkflowDagFlowEdge = FlowEdge<WorkflowDagEdgeData, 'dag'>

/** How far past the source/target the path travels horizontally before bending to `laneY`. */
const BEND_INSET = 24

function buildBendPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  laneY: number
): string {
  const inset = Math.min(BEND_INSET, Math.abs(targetX - sourceX) / 3)
  const x1 = sourceX + inset
  const x2 = targetX - inset
  return `M ${sourceX} ${sourceY} L ${x1} ${laneY} L ${x2} ${laneY} L ${targetX} ${targetY}`
}

/** F10: renders the same bezier React Flow's default edge would when `data.laneY` is unset, or a
 *  path bent through that lane when a sibling node would otherwise sit behind a straight line.
 *  F10 round 1: `<BaseEdge>` forwards unknown props onto the DOM `<path>`, so this destructures
 *  only the fields `<BaseEdge>` itself declares (same subset React Flow's own built-in edges use)
 *  instead of spreading the full `EdgeProps` — `sourceX`/`data`/`selected`/… never reach the DOM. */
export default function WorkflowDagEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  style,
  markerStart,
  markerEnd,
  label,
  labelStyle,
  labelShowBg,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  interactionWidth
}: EdgeProps<WorkflowDagFlowEdge>): React.JSX.Element {
  const laneY = data?.laneY
  const [bezierPath, bezierLabelX, bezierLabelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY
  })
  const path =
    laneY === undefined ? bezierPath : buildBendPath(sourceX, sourceY, targetX, targetY, laneY)
  const labelX = laneY === undefined ? bezierLabelX : (sourceX + targetX) / 2
  const labelY = laneY === undefined ? bezierLabelY : laneY

  return (
    <BaseEdge
      id={id}
      path={path}
      labelX={labelX}
      labelY={labelY}
      label={label}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
      interactionWidth={interactionWidth}
      style={style}
      markerStart={markerStart}
      markerEnd={markerEnd}
    />
  )
}
