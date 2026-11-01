/** Drawing geometry is local to its origin; scale points as well as its bounding box. */
export function scaledDrawingShape(shape, factor, factorY = factor) {
  return {
    width: shape.width * factor,
    height: shape.height * factorY,
    ...(Array.isArray(shape.points) ? { points: shape.points.map((v, i) => v * (i % 2 ? factorY : factor)) } : {})
  };
}
