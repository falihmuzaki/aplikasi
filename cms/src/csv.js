export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '')
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  let afterQuote = false

  const pushField = () => {
    row.push(field)
    field = ''
    afterQuote = false
  }
  const pushRow = () => {
    pushField()
    if (row.some((cell) => cell.trim() !== '')) rows.push(row)
    row = []
  }

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]

    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else if (character === '\r') {
        if (input[index + 1] === '\n') index += 1
        field += '\n'
      } else {
        field += character
      }
      continue
    }

    if (afterQuote) {
      if (character === ',') pushField()
      else if (character === '\r' || character === '\n') {
        if (character === '\r' && input[index + 1] === '\n') index += 1
        pushRow()
      } else if (character === ' ' || character === '\t') {
        field += character
      } else {
        throw new Error(`Tanda kutip CSV tidak valid di posisi ${index + 1}.`)
      }
      continue
    }

    if (character === '"') {
      if (field.trim() !== '') throw new Error(`Tanda kutip CSV tidak valid di posisi ${index + 1}.`)
      field = ''
      inQuotes = true
    } else if (character === ',') {
      pushField()
    } else if (character === '\r' || character === '\n') {
      if (character === '\r' && input[index + 1] === '\n') index += 1
      pushRow()
    } else {
      field += character
    }
  }

  if (inQuotes) throw new Error('CSV memiliki tanda kutip yang belum ditutup.')
  if (field !== '' || row.length > 0 || afterQuote) pushRow()
  return rows
}
