export interface ScrollAnchor {
  source: number;
  preview: number;
}

/** Piecewise interpolation keeps paragraphs aligned despite different heights. */
export function mapMarkdownScroll(
  position: number,
  anchors: ScrollAnchor[],
  from: "source" | "preview",
) {
  const to = from === "source" ? "preview" : "source";
  if (!anchors.length) return 0;
  if (position <= anchors[0][from]) return anchors[0][to];
  for (let index = 1; index < anchors.length; index++) {
    const previous = anchors[index - 1],
      next = anchors[index];
    if (position <= next[from]) {
      const distance = next[from] - previous[from];
      return distance > 0
        ? previous[to] +
            ((next[to] - previous[to]) * (position - previous[from])) / distance
        : next[to];
    }
  }
  return anchors.at(-1)![to];
}
