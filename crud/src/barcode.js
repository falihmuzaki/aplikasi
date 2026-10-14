// Self-contained Code128-B SVG barcode generator. No runtime dependency.
// Each pattern is a 6-digit string of alternating bar/space module widths,
// starting with a bar. Index 0..102 are the data/control symbols; 103 Start-A,
// 104 Start-B, 105 Start-C, 106 Stop (with its trailing 2-bar, 7 modules).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]

// Returns an SVG string rendering `value` as a Code128-B barcode. Non-ASCII or
// out-of-range characters are skipped so the SVG stays valid.
export function code128BarcodeSvg(value, { height = 48, moduleWidth = 2 } = {}) {
  const text = String(value ?? '')
  const codes = []
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i) - 32
    if (code >= 0 && code <= 94) codes.push(code)
  }
  const START_B = 104
  const STOP = 106
  const symbols = [START_B, ...codes]
  let checksum = START_B
  codes.forEach((code, index) => { checksum += code * (index + 1) })
  symbols.push(checksum % 103)
  symbols.push(STOP)

  const rects = []
  let x = 0
  for (const symbol of symbols) {
    const pattern = PATTERNS[symbol]
    for (let i = 0; i < pattern.length; i += 1) {
      const widthModules = Number(pattern[i])
      const width = widthModules * moduleWidth
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${width}" height="${height}" fill="#192332" />`)
      x += width
    }
  }
  const totalWidth = x
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="${height}" viewBox="0 0 ${totalWidth} ${height}" role="img" aria-label="Barcode ${text}"><rect x="0" y="0" width="${totalWidth}" height="${height}" fill="#ffffff" />${rects.join('')}</svg>`
}
