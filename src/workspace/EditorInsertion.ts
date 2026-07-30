export function insertTextRange(
  original: string,
  startOffset: number,
  endOffset: number,
  insertion: string,
): string {
  if (
    !Number.isInteger(startOffset) ||
    !Number.isInteger(endOffset) ||
    startOffset < 0 ||
    endOffset < startOffset ||
    endOffset > original.length
  ) {
    throw new Error("编辑器选区范围无效，无法生成安全变更。");
  }
  return `${original.slice(0, startOffset)}${insertion}${original.slice(endOffset)}`;
}
